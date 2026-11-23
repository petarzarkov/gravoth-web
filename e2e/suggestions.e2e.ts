// `bun run e2e` (e2e/run.sh): decision 229's friend suggestions over the local production stack, as the game calls them:
// a guest refused; friends of friends from requests and answers; a neighbour on the pit floor from two online realms the
// rules checker reads (the boards as they show, online heroes only); a partner from the global chat; the ranking with
// two sources first; a dismissal (204, gone at once) and its 404 and 400; a hidden profile and a block leaving a cached
// list at once; the dismissals going with the account. Runs before api.e2e.ts, so the restore drill there carries a
// dismissal. Prints one line per check; exits 1 if any failed.
const base = 'http://localhost:3000';
const run = Date.now().toString(36).slice(-5);
/** The game's own header (decision 223), which also names its version for the checker's build snapshots. */
const GAME = { 'x-gravoth-client': 'game/0.13.1' };
let failed = 0;
const ok = (name: string, cond: boolean, detail: unknown = '') => {
  if (!cond) failed++;
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`,
  );
};

let nextIp = 120;
const call = async (
  method: string,
  path: string,
  opts: {
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) => {
  const headers: Record<string, string> = {
    // better-auth counts sign-ups by this header; each player its own address.
    'cf-connecting-ip': `198.51.100.${nextIp}`,
    ...opts.headers,
  };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = text === '' ? {} : JSON.parse(text);
  } catch {}
  return { status: res.status, body };
};
const signUp = async (name: string) => {
  nextIp++;
  const res = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': `198.51.100.${nextIp}`,
    },
    body: JSON.stringify({
      name,
      email: `${name.toLowerCase()}-${run}@example.test`,
      password: 'a long enough password',
    }),
  });
  const token = res.headers.get('set-auth-token') ?? '';
  const id = ((await res.json()) as any)?.user?.id as string;
  const displayName = `${name}${run}`;
  await call('PATCH', '/api/profile', { token, body: { displayName } });
  return { token, id, displayName };
};
type Player = Awaited<ReturnType<typeof signUp>>;

const suggestionsOf = async (who: Player) =>
  (await call('GET', '/api/friends/suggestions', { token: who.token })).body
    .items as any[];
const of = (items: any[], who: Player) =>
  items.find((item) => item.userId === who.id);
const befriend = async (from: Player, to: Player) => {
  await call('POST', '/api/friends/requests', {
    token: from.token,
    body: { displayName: to.displayName },
  });
  const incoming = await call('GET', '/api/friends/requests/incoming', {
    token: to.token,
  });
  const request = incoming.body.data?.find((r: any) => r.userId === from.id);
  return call('POST', `/api/friends/requests/${request?.id}/accept`, {
    token: to.token,
  });
};
/** An online realm the save generator wrote (e2e/savegen), its hero renamed, up and read by the rules checker. */
const realm = async (who: Player, file: string, hero: string) => {
  const text = (
    await Bun.file(`${import.meta.dir}/.tmp/${file}.txt`).text()
  ).replace(new RegExp(`^name ${hero}$`, 'm'), `name ${hero}${run}`);
  await call('POST', '/api/realm/lease', {
    token: who.token,
    body: { deviceId: 'phone' },
  });
  await call('PUT', '/api/realm', {
    token: who.token,
    headers: GAME,
    body: {
      deviceId: 'phone',
      baseRevision: 0,
      data: Buffer.from(text).toString('base64'),
      reason: 'create',
    },
  });
  let read = await call('GET', '/api/realm', { token: who.token });
  for (
    let i = 0;
    i < 80 && read.body.checkedRevision !== read.body.revision;
    i++
  ) {
    await Bun.sleep(250);
    read = await call('GET', '/api/realm', { token: who.token });
  }
  return read.body.heroes?.some((h: any) => h.name === `${hero}${run}`);
};

// Ivo is the one suggested to; Jo is Ivo's friend and Kim Jo's; Lu plays near Ivo on the pit floor; Mo chats with Ivo.
const [ivo, jo, kim, lu, mo] = [
  await signUp('Ivo'),
  await signUp('Jo'),
  await signUp('Kim'),
  await signUp('Lu'),
  await signUp('Mo'),
];
ok(
  'five players sign up',
  [ivo, jo, kim, lu, mo].every((p) => p.token !== '' && p.id !== undefined),
);

// ---- 1. A guest has none.
{
  const res = await fetch(`${base}/api/auth/sign-in/anonymous`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '198.51.100.119',
    },
    body: '{}',
  });
  const token = res.headers.get('set-auth-token') ?? '';
  const read = await call('GET', '/api/friends/suggestions', { token });
  const hide = await call(
    'POST',
    `/api/friends/suggestions/${ivo.id}/dismiss`,
    {
      token,
    },
  );
  ok(
    'a guest gets 403 GUEST_ACCOUNT, reading or hiding',
    read.status === 403 &&
      read.body.error === 'GUEST_ACCOUNT' &&
      hide.status === 403 &&
      hide.body.error === 'GUEST_ACCOUNT',
    [read.body, hide.body],
  );
}

// ---- 2. The sources: friends of friends, the board, the global chat.
{
  const friends = [await befriend(ivo, jo), await befriend(jo, kim)];
  ok(
    'Ivo and Jo, and Jo and Kim, become friends',
    friends.every((r) => r.status === 200),
    friends.map((r) => r.body),
  );
  const boards = [
    await realm(ivo, 'realm-ana', 'Ashgrove'),
    await realm(lu, 'realm-cy', 'Cyril'),
  ];
  ok(
    "Ivo's and Lu's realms go up and the checker reads them",
    boards.every(Boolean),
    boards,
  );
  for (const p of [ivo, kim, mo])
    await call('POST', '/api/chat/rules/accept', { token: p.token });
  const said = [
    await call('POST', '/api/chat/global', {
      token: ivo.token,
      body: { body: `anyone for the Bone Pit? ${run}` },
    }),
    await call('POST', '/api/chat/global', {
      token: kim.token,
      body: { body: `me, in a minute ${run}` },
    }),
    await call('POST', '/api/chat/global', {
      token: mo.token,
      body: { body: `count me in ${run}` },
    }),
  ];
  ok(
    'Ivo, Kim and Mo write in Global',
    said.every((r) => r.status === 200),
    said.map((r) => r.body),
  );

  const items = await suggestionsOf(ivo);
  const kimFor = of(items, kim);
  ok(
    "Kim, Jo's friend who chatted with Ivo, is first, with both reasons",
    items[0]?.userId === kim.id &&
      JSON.stringify(kimFor?.reasons) ===
        JSON.stringify([{ kind: 'mutual', count: 1 }, { kind: 'chat' }]) &&
      kimFor?.note === '1 mutual friend · Chatted with you in Global' &&
      kimFor?.displayName === kim.displayName &&
      kimFor?.avatar?.kind === 'portrait',
    items.slice(0, 3),
  );
  const luFor = of(items, lu);
  const near = luFor?.reasons?.[0];
  ok(
    "Lu, above Ivo on the pit floor as the board shows it, is suggested by the board's key and title",
    near?.kind === 'board' &&
      near.boardId === 'pit_floor' &&
      near.boardTitle === 'Deepest Bone Pit floor' &&
      near.theirRank < near.yourRank &&
      near.yourRank - near.theirRank <= 5 &&
      luFor.note === 'Near you on Deepest Bone Pit floor',
    luFor,
  );
  const moFor = of(items, mo);
  ok(
    'Mo, who wrote in Global with Ivo, is suggested for the chat, after the board',
    moFor?.note === 'Chatted with you in Global' &&
      items.indexOf(luFor) < items.indexOf(moFor),
    moFor,
  );
  ok(
    "never Ivo, nor Ivo's friend Jo; at most 20",
    !of(items, ivo) && !of(items, jo) && items.length <= 20,
    items.length,
  );
}

// ---- 3. Hiding a suggestion, and what leaves a list at once.
{
  const hide = await call('POST', `/api/friends/suggestions/${mo.id}/dismiss`, {
    token: ivo.token,
  });
  ok(
    'Ivo hides Mo: 204, and Mo is gone at once',
    hide.status === 204 && !of(await suggestionsOf(ivo), mo),
    hide,
  );
  const [unknown, malformed, self] = [
    await call(
      'POST',
      `/api/friends/suggestions/${crypto.randomUUID()}/dismiss`,
      { token: ivo.token },
    ),
    await call('POST', '/api/friends/suggestions/nobody/dismiss', {
      token: ivo.token,
    }),
    await call('POST', `/api/friends/suggestions/${ivo.id}/dismiss`, {
      token: ivo.token,
    }),
  ];
  ok(
    'hiding no such player or oneself is 404 PLAYER_NOT_FOUND, a malformed id 400',
    unknown.status === 404 &&
      unknown.body.error === 'PLAYER_NOT_FOUND' &&
      self.status === 404 &&
      malformed.status === 400,
    [unknown.status, self.status, malformed.status],
  );
  await call('PATCH', '/api/profile', {
    token: lu.token,
    body: { publicProfile: false },
  });
  ok(
    'a profile hidden since the list was made leaves it at once',
    !of(await suggestionsOf(ivo), lu),
  );
  const blocked = await call('POST', '/api/blocks', {
    token: kim.token,
    body: { displayName: ivo.displayName },
  });
  ok(
    'a player who blocks Ivo is never suggested to Ivo, nor Ivo to them',
    blocked.status === 200 &&
      !of(await suggestionsOf(ivo), kim) &&
      !of(await suggestionsOf(kim), ivo),
    blocked.body,
  );
  // Jo keeps one, for the restore drill in api.e2e.ts.
  await call('POST', `/api/friends/suggestions/${mo.id}/dismiss`, {
    token: jo.token,
  });
}

// ---- 4. The dismissals go with the account.
{
  const deleted = await call('POST', '/api/account/delete', {
    token: ivo.token,
    body: { password: 'a long enough password' },
  });
  const left = await Bun.spawn(
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
      `select (select count(*) from suggestion_dismissals where user_id = '${ivo.id}' or dismissed_id = '${ivo.id}') || ' ' || (select count(*) from suggestion_dismissals where user_id = '${jo.id}')`,
    ],
    { stdout: 'pipe' },
  );
  const counts = (await new Response(left.stdout).text()).trim();
  ok(
    "Ivo deletes the account, and Ivo's dismissals go with it, Jo's stay",
    deleted.status === 200 && counts === '0 1',
    [deleted.status, counts],
  );
}

console.log(failed === 0 ? '\nall passed' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
