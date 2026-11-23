// `bun run e2e` (e2e/run.sh): Redis stopped and started again under the running app, with no app restart (the app's one
// connection reconnects by itself, apps/server/src/cache/app-redis.ts). While it is down every call answers and the
// rate limit still applies (counted in the app's memory); once it is back the rate limit counts in Redis again and
// refuses past its limit, and the cache writes there again. Read through `redis-cli` in the Redis container. Prints one
// line per check; exits 1 if any failed.
const base = 'http://localhost:3000';
const run = Date.now().toString(36).slice(-5);
let failed = 0;
const ok = (name: string, cond: boolean, detail: unknown = '') => {
  if (!cond) failed++;
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`,
  );
};

type Reply = { status: number; body: any; token: string | null };
const call = async (
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<Reply> => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'cf-connecting-ip': '198.51.100.230',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = text === '' ? {} : JSON.parse(text);
  } catch {}
  return { status: res.status, body, token: res.headers.get('set-auth-token') };
};
const docker = async (...args: string[]) => {
  const p = Bun.spawn(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out.trim();
};
const redis = (...args: string[]) =>
  docker('exec', 'gravoth-redis', 'redis-cli', ...args);
/** The keys matching `pattern`, read with SCAN. */
const keys = async (pattern: string) =>
  (await redis('--scan', '--pattern', pattern))
    .split('\n')
    .filter((key) => key !== '');

/** The game sign-in's code exchange: 30 calls per 10 minutes per address, counted before the code is read. */
const LIMIT = 30;
const EXCHANGE_KEY = '*:throttle:GameSignInController:exchange:*';
/** `LIMIT + 1` calls to it: every status, in order. */
const burst = async () => {
  const statuses: number[] = [];
  for (let i = 0; i <= LIMIT; i++)
    statuses.push(
      (
        await call('POST', '/api/account/game-sign-in/exchange', {
          body: { code: `not-a-code-${i}` },
        })
      ).status,
    );
  return statuses;
};
const limited = (statuses: number[]) =>
  statuses.slice(0, LIMIT).every((s) => s !== 429 && s < 500) &&
  statuses[LIMIT] === 429;

const signedUp = await call('POST', '/api/auth/sign-up/email', {
  body: {
    name: 'Yara',
    email: `yara-${run}@redis.test`,
    password: 'a long enough password',
  },
});
const yara = { token: signedUp.token!, id: signedUp.body.user?.id as string };
ok('a player signs up', !!yara.token && !!yara.id, signedUp.body);

// ---- 1. Redis stopped: every call answers, and the rate limit still applies, in memory.
{
  await docker('stop', 'gravoth-redis');
  const suggestions = await call('GET', '/api/friends/suggestions', {
    token: yara.token,
  });
  const statuses = await burst();
  ok(
    'with Redis stopped the cached route answers, and the rate limit still refuses past its limit',
    suggestions.status === 200 && limited(statuses),
    [suggestions.status, statuses],
  );
}

// ---- 2. Redis started again, emptied, and the app (never restarted) finds it again.
{
  await docker('start', 'gravoth-redis');
  let pong = '';
  for (let i = 0; i < 60 && pong !== 'PONG'; i++) {
    pong = await redis('ping');
    if (pong !== 'PONG') await Bun.sleep(250);
  }
  await redis('flushall');
  let back = false;
  const started = performance.now();
  for (let i = 0; i < 40 && !back; i++) {
    await call('GET', '/api/leaderboards');
    back = (await keys('*:throttle:*')).length > 0;
    if (!back) await Bun.sleep(500);
  }
  ok(
    'Redis back: the app counts there again, with no restart',
    pong === 'PONG' && back,
    [pong, Math.round(performance.now() - started)],
  );
}

// ---- 3. The rate limit counts in Redis again and refuses past its limit; the cache writes there again.
{
  const statuses = await burst();
  const [exchangeKey] = await keys(EXCHANGE_KEY);
  const counted =
    exchangeKey === undefined ? '' : await redis('get', exchangeKey);
  const left = exchangeKey === undefined ? '' : await redis('ttl', exchangeKey);
  ok(
    'the rate limit refuses past its limit again, counted in Redis with its window',
    limited(statuses) &&
      counted === String(LIMIT + 1) &&
      Number(left) > 0 &&
      Number(left) <= 600,
    [statuses, exchangeKey, counted, left],
  );
  // A player new since Redis came back, so nothing of theirs was cached before (in Redis or the app's memory).
  const zia = await call('POST', '/api/auth/sign-up/email', {
    body: {
      name: 'Zia',
      email: `zia-${run}@redis.test`,
      password: 'a long enough password',
    },
  });
  const suggestions = await call('GET', '/api/friends/suggestions', {
    token: zia.token!,
  });
  const cached = await keys(`*suggestions:${zia.body.user?.id}*`);
  ok(
    "the cache writes to Redis again (a new player's friend suggestions)",
    suggestions.status === 200 && cached.length === 1,
    [zia.status, suggestions.status, cached],
  );
}

console.log(failed === 0 ? '\nall passed' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
