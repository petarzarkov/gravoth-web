// `bun run e2e` (e2e/run.sh): friends' online status (v0.14.4) over the local production stack and its real Redis, as the
// game calls it: a friend's signed-in request (the game's launch call) shows them online in the friends list and in the
// conversations, both ways; their "Show when online" switch off hides it; a stranger is never shown; with Redis stopped
// every call still answers and everyone reads offline. Its own players, so it stands alone. Prints one line per check;
// exits 1 if any failed.
const base = 'http://localhost:3000';
const run = Date.now().toString(36).slice(-5);
const GAME = { 'x-gravoth-client': 'game/0.14.4' };
let failed = 0;
const ok = (name: string, cond: boolean, detail: unknown = '') => {
  if (!cond) failed++;
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`,
  );
};

type Reply = { status: number; body: any; token: string | null };
let nextIp = 160;
const call = async (
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<Reply> => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      // better-auth counts sign-ups by this header; each player its own address.
      'cf-connecting-ip': `198.51.100.${nextIp}`,
      ...GAME,
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
const sh = async (cmd: string[]) => {
  const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  await p.exited;
};

// ---- The players: Uma and Vik are friends, Wes is neither's.
const players: Record<string, { token: string; id: string; name: string }> = {};
for (const who of ['Uma', 'Vik', 'Wes']) {
  nextIp++;
  const r = await call('POST', '/api/auth/sign-up/email', {
    body: {
      name: who,
      email: `${who.toLowerCase()}-${run}@presence.test`,
      password: 'a long enough password',
    },
  });
  const name = `${who}${run}`;
  await call('PATCH', '/api/profile', {
    token: r.token!,
    body: { displayName: name },
  });
  players[who] = { token: r.token!, id: r.body.user?.id, name };
}
const { Uma: uma, Vik: vik, Wes: wes } = players as Required<typeof players>;
ok('three players sign up', !!uma?.token && !!vik?.token && !!wes?.token);
const asked = await call('POST', '/api/friends/requests', {
  token: uma!.token,
  body: { displayName: vik!.name },
});
await call('POST', `/api/friends/requests/${asked.body.request?.id}/accept`, {
  token: vik!.token,
});

/** Whether `who` sees `friend` online in their friends list (undefined: not on it). */
const seen = async (who: typeof uma, friend: typeof uma) => {
  const list = await call('GET', '/api/friends', { token: who!.token });
  return list.body.data?.find((f: any) => f.userId === friend!.id)?.online;
};

// ---- 1. The friends list.
{
  const launch = await call('GET', '/api/account', { token: vik!.token });
  ok(
    "Vik's game launches (GET /api/account): Uma sees him online",
    launch.status === 200 && (await seen(uma, vik)) === true,
  );
  ok(
    'and Vik sees Uma online, who just read her list',
    (await seen(vik, uma)) === true,
  );
  const list = await call('GET', '/api/friends', { token: uma!.token });
  ok(
    'a stranger is never on the list, online or not',
    list.status === 200 &&
      !list.body.data.some((f: any) => f.userId === wes!.id) &&
      list.body.data.every((f: any) => typeof f.online === 'boolean'),
    list.body,
  );
  await call('PATCH', '/api/profile', {
    token: vik!.token,
    body: { showOnline: false },
  });
  const hidden = await seen(uma, vik);
  await call('PATCH', '/api/profile', {
    token: vik!.token,
    body: { showOnline: true },
  });
  ok(
    'with "Show when online" off Vik is offline to Uma, and online again when it is back on',
    hidden === false && (await seen(uma, vik)) === true,
    hidden,
  );
}

// ---- 2. The conversations.
{
  for (const who of [uma, vik])
    await call('POST', '/api/chat/rules/accept', { token: who!.token });
  const sent = await call('POST', `/api/chat/direct/${vik!.id}`, {
    token: uma!.token,
    body: { body: `hi ${vik!.name}` },
  });
  const mine = await call('GET', '/api/chat/direct', { token: uma!.token });
  const his = await call('GET', '/api/chat/direct', { token: vik!.token });
  ok(
    'a conversation shows its peer online, both ways',
    sent.status === 200 &&
      mine.body.conversations?.find((c: any) => c.peer.userId === vik!.id)
        ?.online === true &&
      his.body.conversations?.find((c: any) => c.peer.userId === uma!.id)
        ?.online === true,
    [sent.body, mine.body, his.body],
  );
  await call('POST', `/api/friends/${vik!.id}/remove`, { token: uma!.token });
  const after = await call('GET', '/api/chat/direct', { token: uma!.token });
  ok(
    'once they are no longer friends the conversation stays, never online',
    after.body.conversations?.find((c: any) => c.peer.userId === vik!.id)
      ?.online === false,
    after.body,
  );
  const again = await call('POST', '/api/friends/requests', {
    token: uma!.token,
    body: { displayName: vik!.name },
  });
  await call('POST', `/api/friends/requests/${again.body.request?.id}/accept`, {
    token: vik!.token,
  });
}

// ---- 3. Redis stopped: every call answers, everyone offline.
{
  await sh(['docker', 'stop', 'gravoth-redis']);
  const started = performance.now();
  const account = await call('GET', '/api/account', { token: vik!.token });
  const list = await call('GET', '/api/friends', { token: uma!.token });
  const chats = await call('GET', '/api/chat/direct', { token: uma!.token });
  const took = performance.now() - started;
  ok(
    'with Redis stopped the calls still answer, quickly, and Vik reads offline',
    account.status === 200 &&
      list.status === 200 &&
      chats.status === 200 &&
      list.body.data?.find((f: any) => f.userId === vik!.id)?.online ===
        false &&
      took < 5_000,
    [account.status, list.status, chats.status, Math.round(took), list.body],
  );
  await sh(['docker', 'start', 'gravoth-redis']);
  // Back: Vik reads online again, his mark kept by Redis or made anew at his next call past the 30 s window.
  let back = false;
  for (let i = 0; i < 25 && !back; i++) {
    await call('GET', '/api/account', { token: vik!.token });
    back = (await seen(uma, vik)) === true;
    if (!back) await Bun.sleep(2_000);
  }
  ok('with Redis back, Vik reads online again', back);
}

console.log(failed === 0 ? '\nall passed' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
