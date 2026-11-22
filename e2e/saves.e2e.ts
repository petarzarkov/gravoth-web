// `bun run e2e` (e2e/run.sh), before api.e2e.ts: the cloud save (decision 225) as the game keeps it, over the local
// production stack: written, read back to the byte (zeros and high bytes), shown without its data, replaced whole,
// refused when it is not base64 or over 3 MB, never a guest's, deleted. It leaves one copy behind for api.e2e.ts's
// restore drill. Prints one line per check; exits 1 if any failed.
const base = 'http://localhost:3000';
const run = Date.now().toString(36);
let failed = 0;
const ok = (name: string, cond: boolean, detail: unknown = '') => {
  if (!cond) failed++;
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${JSON.stringify(detail)}`}`,
  );
};
const call = async (
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; ip?: string } = {},
) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(opts.ip ? { 'cf-connecting-ip': opts.ip } : {}),
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
/** One value from the live database. */
const psql = async (query: string) => {
  const p = Bun.spawn(
    [
      'docker',
      'exec',
      'gravoth-postgres',
      'psql',
      '-U',
      'gravoth',
      '-d',
      'gravoth',
      '-tAc',
      query,
    ],
    { stdout: 'pipe', stderr: 'ignore' },
  );
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out.trim();
};
/** Bytes a text column would mangle: zeros, the high half, every byte value. */
const saveBytes = (length: number, salt: number) => {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 7919 + salt) % 256;
  bytes.set([0, 0, 255, 254, 128, 0], 0);
  return bytes;
};
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

const signedUp = await call('POST', '/api/auth/sign-up/email', {
  body: {
    name: 'Saver',
    email: `saver-${run}@example.test`,
    password: 'a long enough password',
  },
  ip: '198.51.100.70',
});
ok(
  'a player signs up',
  signedUp.status === 200 && signedUp.token !== null,
  signedUp.body,
);
const player = { token: signedUp.token!, id: signedUp.body.user?.id as string };

const none = await call('GET', '/api/saves/me', { token: player.token });
ok(
  'an account starts without a cloud save',
  none.status === 200 &&
    none.body.exists === false &&
    none.body.data === null &&
    none.body.size === 0,
  none.body,
);
const first = saveBytes(48_000, 1);
const put = await call('PUT', '/api/saves/me', {
  token: player.token,
  body: {
    data: b64(first),
    description: 'Ashgrove, level 58 (2 characters)',
    playSeconds: 148_020,
    gameVersion: '0.13.1',
  },
});
ok(
  'the game writes its cloud save and gets it back without the data',
  put.status === 200 &&
    put.body.exists === true &&
    put.body.data === null &&
    put.body.size === first.length &&
    put.body.playSeconds === 148_020 &&
    put.body.gameVersion === '0.13.1',
  put.body,
);
const read = await call('GET', '/api/saves/me', { token: player.token });
ok(
  'reading it back gives the exact bytes, zeros and high bytes included',
  read.status === 200 &&
    read.body.data === b64(first) &&
    Buffer.compare(
      Buffer.from(read.body.data, 'base64'),
      Buffer.from(first),
    ) === 0 &&
    read.body.description === 'Ashgrove, level 58 (2 characters)',
  { status: read.status, size: read.body.size },
);
ok(
  'the database keeps the decoded bytes, their size and hash',
  (await psql(
    `select octet_length(data) || ' ' || (encode(sha256(data), 'hex') = sha256) from cloud_saves where user_id = '${player.id}'`,
  )) === `${first.length} true`,
);
const short = await call('GET', '/api/saves/me?data=false', {
  token: player.token,
});
ok(
  '?data=false (the website) leaves the data out',
  short.status === 200 &&
    short.body.exists === true &&
    short.body.data === null &&
    short.body.size === first.length,
  short.body,
);
const second = saveBytes(1_000, 2);
const replaced = await call('PUT', '/api/saves/me', {
  token: player.token,
  body: { data: b64(second), description: 'replaced' },
});
const after = await call('GET', '/api/saves/me', { token: player.token });
ok(
  'a write replaces the copy whole',
  replaced.status === 200 &&
    after.body.data === b64(second) &&
    after.body.description === 'replaced' &&
    after.body.gameVersion === null &&
    after.body.playSeconds === 0,
  after.body,
);
const notBase64 = await call('PUT', '/api/saves/me', {
  token: player.token,
  body: { data: 'AAAAA' },
});
const tooLarge = await call('PUT', '/api/saves/me', {
  token: player.token,
  body: { data: 'A'.repeat(4_000_004) },
});
ok(
  'data that is not base64 is refused, and a save over 3 MB with SAVE_TOO_LARGE',
  notBase64.status === 400 &&
    tooLarge.status === 413 &&
    tooLarge.body.error === 'SAVE_TOO_LARGE',
  [notBase64.status, tooLarge.status, tooLarge.body],
);
const g = await call('POST', '/api/auth/sign-in/anonymous', {
  body: {},
  ip: '198.51.100.71',
});
const refused = [
  await call('GET', '/api/saves/me', { token: g.token! }),
  await call('PUT', '/api/saves/me', {
    token: g.token!,
    body: { data: 'AAAA' },
  }),
  await call('DELETE', '/api/saves/me', { token: g.token! }),
];
ok(
  'a guest has no cloud save: 403 GUEST_ACCOUNT on all three',
  refused.every((r) => r.status === 403 && r.body.error === 'GUEST_ACCOUNT'),
  refused.map((r) => [r.status, r.body.error]),
);
const del = await call('DELETE', '/api/saves/me', { token: player.token });
const gone = await call('GET', '/api/saves/me', { token: player.token });
const again = await call('DELETE', '/api/saves/me', { token: player.token });
ok(
  'deleting removes the copy, and a second delete says there was none',
  del.status === 200 &&
    del.body.deleted === true &&
    gone.body.exists === false &&
    again.body.deleted === false &&
    (await psql(
      `select count(*) from cloud_saves where user_id = '${player.id}'`,
    )) === '0',
  [del.body, gone.body, again.body],
);
// Kept, for api.e2e.ts's restore drill, which checks the bytes come back.
await call('PUT', '/api/saves/me', {
  token: player.token,
  body: { data: b64(first), description: 'for the drill' },
});

console.log(failed === 0 ? '\nall passed' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
