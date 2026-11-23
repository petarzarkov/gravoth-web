// `bun run e2e` (e2e/run.sh): decisions 226 and 227 end to end over the local production stack, as the game calls them, with
// the rules checker built from the game's repository reading saves the game's Core wrote (e2e/savegen): every hero's build
// and the player pages (public, or for friends only when hidden), and the online realm: the one-device lease (refused,
// lost, forced, released), revisions, the one-time transfer (refused a second time, to this account or another, and a
// move retried after a lost answer told it landed), two phones' offline heroes (decision 229), the boards showing an
// online hero's record read from its realm and never an offline hero's submission, and the checker down. Its own players,
// so it stands alone. Prints one line per check; exits 1 if any failed.
const base = 'http://localhost:3000';
const save = await Bun.file(`${import.meta.dir}/.tmp/save.txt`).text();
const run = Date.now().toString(36);
const sfx = run.slice(-3);
const GAME = { 'x-gravoth-client': 'game/0.13.1' };
let failed = 0;
const ok = (name: string, cond: boolean, detail: unknown = '') => {
  if (!cond) failed++;
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`,
  );
};

type Reply = { status: number; body: any; token: string | null };
let nextIp = 30;
const call = async (
  method: string,
  path: string,
  opts: {
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<Reply> => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'cf-connecting-ip': `203.0.113.${nextIp}`,
      ...opts.headers,
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

/** A realm the save generator wrote, its heroes renamed for this run, as base64 for `PUT /api/realm`. */
const realmFile = async (file: string, renames: Record<string, string>) => {
  let text = await Bun.file(`${import.meta.dir}/.tmp/${file}.txt`).text();
  for (const [from, to] of Object.entries(renames))
    text = text.replace(new RegExp(`^name ${from}$`, 'm'), `name ${to}`);
  return Buffer.from(text).toString('base64');
};
const lease = (token: string, deviceId: string, force?: boolean) =>
  call('POST', '/api/realm/lease', {
    token,
    body: { deviceId, ...(force === undefined ? {} : { force }) },
  });
const upload = (token: string, body: Record<string, unknown>) =>
  call('PUT', '/api/realm', {
    token,
    headers: GAME,
    body: { reason: 'checkpoint', ...body },
  });
/** The realm once the rules checker has read its latest revision. */
const checkedRealm = async (token: string) => {
  let r = await call('GET', '/api/realm', { token });
  for (let i = 0; i < 80 && r.body.checkedRevision !== r.body.revision; i++) {
    await Bun.sleep(250);
    r = await call('GET', '/api/realm', { token });
  }
  return r;
};
const build = (level: number, revision: number) => ({
  revision,
  gameVersion: '0.13.0',
  level,
  skills: [{ id: 'cleave', level: 18, slot: 0, supports: [] }],
  gear: [],
  talents: { allocated: [1, 2, 3] },
  summary: { dps: 12_000, clearDps: 9_000, ehp: 20_000, life: 3_000 },
});

// ---- The players: Rae and Sol are friends, Tam is neither's.
const players: Record<string, { token: string; id: string; name: string }> = {};
for (const who of ['Rae', 'Sol', 'Tam']) {
  nextIp++;
  const r = await call('POST', '/api/auth/sign-up/email', {
    body: {
      name: who,
      email: `${who.toLowerCase()}-${run}@example.test`,
      password: 'a long enough password',
    },
  });
  const name = `${who}${run.slice(-5)}`;
  await call('PATCH', '/api/profile', {
    token: r.token!,
    body: { displayName: name },
  });
  players[who] = { token: r.token!, id: r.body.user.id, name };
}
const { Rae: rae, Sol: sol, Tam: tam } = players as Required<typeof players>;
ok('three players sign up', !!rae?.token && !!sol?.token && !!tam?.token);
const asked = await call('POST', '/api/friends/requests', {
  token: rae!.token,
  body: { displayName: sol!.name },
});
await call('POST', `/api/friends/requests/${asked.body.request?.id}/accept`, {
  token: sol!.token,
});

// ---- 1. Every hero's build (decision 226), and an offline hero's record kept off the boards.
let offlineId = '';
{
  const hero = await call('POST', '/api/heroes', {
    token: rae!.token,
    body: { name: 'Ashgrove', class: 'barbarian' },
  });
  offlineId = hero.body.hero?.id;
  const b1 = await call('POST', `/api/heroes/${offlineId}/builds`, {
    token: rae!.token,
    body: { build: build(58, 1), save, saveHeroId: 1 },
  });
  const card = await call('GET', `/api/builds/${b1.body.build?.id}`);
  ok(
    "a hero's build is stored, with the checker's card from the save sent",
    b1.status === 200 &&
      b1.body.created === true &&
      Array.isArray(card.body.card) &&
      card.body.card.length > 0,
    [b1.status, b1.body],
  );
  const b2 = await call('POST', `/api/heroes/${offlineId}/builds`, {
    token: rae!.token,
    body: { build: build(58, 1) },
  });
  ok(
    'the same build again is answered, not stored twice',
    b2.body.created === false && b2.body.build?.id === b1.body.build?.id,
    b2.body,
  );
  const stranger = await call('POST', `/api/heroes/${offlineId}/builds`, {
    token: tam!.token,
    body: { build: build(58, 2) },
  });
  ok(
    "another account's hero is no hero",
    stranger.status === 404 && stranger.body.error === 'HERO_NOT_FOUND',
    stranger.body,
  );
  const scored = await call('POST', '/api/leaderboards/pit_floor/scores', {
    token: rae!.token,
    body: { heroId: offlineId, score: 999, build: build(58, 1) },
  });
  ok(
    "an offline hero's score still answers as v0.13.0 expects, with no rank",
    scored.status === 200 &&
      scored.body.entry?.score === 999 &&
      scored.body.entry.rank === null,
    scored.body,
  );
}

// ---- 2. The online realm (decision 227).
const raeRealm = await realmFile('realm-ana', {
  Ashgrove: `Rook${sfx}`,
  Wren: `Wisp${sfx}`,
});
{
  const first = await lease(rae!.token, 'phone');
  ok(
    "the phone takes the realm's lease, for five minutes",
    first.status === 200 &&
      first.body.revision === 0 &&
      Date.parse(first.body.leaseUntil) > Date.now() + 290_000,
    first.body,
  );
  const other = await lease(rae!.token, 'tablet');
  ok(
    'another device is refused while the lease lives, and told until when',
    other.status === 409 &&
      other.body.error === 'REALM_LEASED' &&
      typeof other.body.leaseUntil === 'string',
    other.body,
  );
  const unleased = await upload(rae!.token, {
    deviceId: 'tablet',
    baseRevision: 0,
    data: raeRealm,
    reason: 'create',
  });
  ok(
    'an upload without the lease is LEASE_LOST',
    unleased.status === 409 && unleased.body.error === 'LEASE_LOST',
    unleased.body,
  );
  const created = await upload(rae!.token, {
    deviceId: 'phone',
    baseRevision: 0,
    data: raeRealm,
    reason: 'create',
  });
  const realm = await checkedRealm(rae!.token);
  ok(
    'the realm goes up at revision 1 and the checker reads its two heroes',
    created.status === 200 &&
      created.body.revision === 1 &&
      realm.body.exists === true &&
      realm.body.data === raeRealm &&
      JSON.stringify(
        realm.body.heroes.map((h: any) => [
          h.characterId,
          h.name,
          h.level,
          h.flagged,
        ]),
      ) ===
        JSON.stringify([
          [1, `Rook${sfx}`, 58, false],
          [2, `Wisp${sfx}`, 44, false],
        ]),
    [created.body, realm.body.heroes],
  );
  const pit = await call('GET', '/api/leaderboards/pit_floor?take=100');
  const rows = pit.body.entries.data.filter(
    (e: any) => e.player.userId === rae!.id,
  );
  ok(
    "the board shows the online hero's record read from its realm (floor 70), not the offline submission (999)",
    rows.length === 1 &&
      rows[0].hero.name === `Rook${sfx}` &&
      rows[0].score === 70 &&
      rows[0].verdict === 'verified',
    rows,
  );
  const built = await call('GET', `/api/builds/${rows[0]?.build.id}`);
  ok(
    "the record's build is the checker's snapshot of the hero, with its card",
    built.body.level === 58 &&
      built.body.gameVersion === '0.13.1' &&
      built.body.hero?.online === true &&
      built.body.card?.length > 0,
    [built.body.level, built.body.gameVersion, built.body.card?.length],
  );
  const stale = await upload(rae!.token, {
    deviceId: 'phone',
    baseRevision: 0,
    data: raeRealm,
  });
  ok(
    'an upload from an old revision is refused with the current one',
    stale.status === 409 &&
      stale.body.error === 'REVISION_MISMATCH' &&
      stale.body.revision === 1,
    stale.body,
  );
  const forced = await lease(rae!.token, 'tablet', true);
  const lost = await upload(rae!.token, {
    deviceId: 'phone',
    baseRevision: 1,
    data: raeRealm,
  });
  ok(
    'the tablet takes the lease by force, and the phone has lost it',
    forced.status === 200 &&
      lost.status === 409 &&
      lost.body.error === 'LEASE_LOST',
    [forced.body, lost.body],
  );
  const tablet = await upload(rae!.token, {
    deviceId: 'tablet',
    baseRevision: 1,
    data: raeRealm,
    reason: 'pause',
  });
  const released = await call('POST', '/api/realm/release', {
    token: rae!.token,
    body: { deviceId: 'tablet' },
  });
  const back = await lease(rae!.token, 'phone');
  ok(
    'the tablet uploads, gives the lease back at quit, and the phone takes it again',
    tablet.body.revision === 2 &&
      released.body.released === true &&
      back.status === 200 &&
      back.body.revision === 2,
    [tablet.body, released.body, back.body],
  );
  const withDrifter = await realmFile('realm-ana2', {
    Ashgrove: `Rook${sfx}`,
    Wren: `Wisp${sfx}`,
    Drifter: `Drifter${sfx}`,
  });
  const moved = await upload(rae!.token, {
    deviceId: 'phone',
    baseRevision: 2,
    data: withDrifter,
    reason: 'transfer',
    transferred: [3],
  });
  ok(
    'an offline hero moves online',
    moved.status === 200 && moved.body.revision === 3,
    moved.body,
  );
  const twice = await upload(rae!.token, {
    deviceId: 'phone',
    baseRevision: 3,
    data: withDrifter,
    reason: 'transfer',
    transferred: [3],
  });
  ok(
    'the same hero moved again is refused, as moved into this account',
    twice.status === 409 &&
      twice.body.error === 'ALREADY_TRANSFERRED' &&
      JSON.stringify(twice.body.characterIds) === '[3]' &&
      twice.body.sameAccount === true,
    twice.body,
  );
  const retried = await upload(rae!.token, {
    deviceId: 'phone',
    baseRevision: 2,
    data: withDrifter,
    reason: 'transfer',
    transferred: [3],
  });
  ok(
    'the move retried after a lost answer (its own base revision) hears that it landed',
    retried.status === 409 &&
      retried.body.error === 'ALREADY_TRANSFERRED' &&
      JSON.stringify(retried.body.characterIds) === '[3]' &&
      retried.body.sameAccount === true,
    retried.body,
  );
  await lease(sol!.token, 'phone');
  const elsewhere = await upload(sol!.token, {
    deviceId: 'phone',
    baseRevision: 0,
    data: await realmFile('realm-bo2', {
      Bodhi: `Bodhi${sfx}`,
      Drifter: `Drifter${sfx}`,
    }),
    reason: 'transfer',
    transferred: [2],
  });
  ok(
    'the same hero cannot move into another account (a restored backup)',
    elsewhere.status === 409 &&
      elsewhere.body.error === 'ALREADY_TRANSFERRED' &&
      JSON.stringify(elsewhere.body.characterIds) === '[2]' &&
      elsewhere.body.sameAccount === false,
    elsewhere.body,
  );
  const sols = await upload(sol!.token, {
    deviceId: 'phone',
    baseRevision: 0,
    data: await realmFile('realm-bo', { Bodhi: `Bodhi${sfx}` }),
    reason: 'create',
  });
  ok(
    "Sol's own realm goes up",
    sols.status === 200 && sols.body.revision === 1,
    sols.body,
  );
  const visitor = await call('POST', '/api/auth/sign-in/anonymous', {
    body: {},
  });
  const guestLease = await lease(visitor.token!, 'phone');
  ok(
    'a guest has no realm',
    guestLease.status === 403 && guestLease.body.error === 'GUEST_ACCOUNT',
    guestLease.body,
  );
}

// ---- 3. Player pages (decision 226): all of a player's heroes, public unless hidden.
{
  await checkedRealm(rae!.token);
  const page = await call('GET', `/api/players/${rae!.id}`);
  const rook = page.body.heroes?.find((h: any) => h.hero.name === `Rook${sfx}`);
  ok(
    "Rae's page shows her online heroes with their newest builds and records, and her offline one",
    page.status === 200 &&
      rook?.hero.online === true &&
      rook.build?.level === 58 &&
      rook.records.some(
        (r: any) => r.board === 'pit_floor' && r.score === 70 && r.rank >= 1,
      ) &&
      page.body.heroes.some(
        (h: any) => !h.hero.online && h.hero.name === 'Ashgrove',
      ),
    page.body.heroes?.map((h: any) => [h.hero.name, h.hero.online, h.records]),
  );
  const active = await call('POST', '/api/heroes/active', {
    token: rae!.token,
    body: { heroIds: [] },
  });
  const after = await call('GET', `/api/players/${rae!.id}`);
  ok(
    'an offline hero no longer on the phone leaves her page; the online ones stay',
    active.body.retired === 1 &&
      after.body.heroes.length === 3 &&
      after.body.heroes.every((h: any) => h.hero.online),
    [active.body, after.body.heroes?.map((h: any) => h.hero.name)],
  );
  await call('PATCH', '/api/profile', {
    token: sol!.token,
    body: { publicProfile: false },
  });
  const toTam = await call('GET', `/api/players/${sol!.id}`, {
    token: tam!.token,
  });
  const toAll = await call('GET', `/api/players/${sol!.id}`);
  const toRae = await call('GET', `/api/players/${sol!.id}`, {
    token: rae!.token,
  });
  ok(
    "a hidden player's page is no player to a stranger, and shows their heroes to a friend",
    toTam.status === 404 &&
      toTam.body.error === 'PLAYER_NOT_FOUND' &&
      toAll.status === 404 &&
      toRae.status === 200 &&
      toRae.body.player.hidden === true &&
      toRae.body.heroes[0]?.hero.name === `Bodhi${sfx}`,
    [toTam.status, toAll.status, toRae.body],
  );
}

// ---- 3b. Two phones with different offline saves (decision 229): each phone's list retires only its own heroes; a hero
// belongs to the phone that last registered it, listed it or posted its build.
{
  const hero = async (name: string, deviceId?: string) =>
    (
      await call('POST', '/api/heroes', {
        token: tam!.token,
        body: {
          name,
          class: 'barbarian',
          ...(deviceId === undefined ? {} : { deviceId }),
        },
      })
    ).body.hero?.id as string;
  const onA = await hero(`OnA${sfx}`, 'tam-phone-a');
  const onB = await hero(`OnB${sfx}`);
  const posted = await call('POST', `/api/heroes/${onB}/builds`, {
    token: tam!.token,
    body: { build: build(20, 1), deviceId: 'tam-phone-b' },
  });
  const active = (heroIds: string[], deviceId: string) =>
    call('POST', '/api/heroes/active', {
      token: tam!.token,
      body: { heroIds, deviceId },
    });
  const names = async () =>
    (await call('GET', `/api/players/${tam!.id}`)).body.heroes
      ?.map((h: any) => h.hero.name)
      .sort();
  const fromA = await active([onA], 'tam-phone-a');
  const fromB = await active([onB], 'tam-phone-b');
  const both = await names();
  ok(
    "two phones' lists keep each other's heroes (a build claims its hero for its phone)",
    posted.status === 200 &&
      fromA.body.retired === 0 &&
      fromB.body.retired === 0 &&
      JSON.stringify(both) === JSON.stringify([`OnA${sfx}`, `OnB${sfx}`]),
    [posted.body, fromA.body, fromB.body, both],
  );
  const gone = await active([], 'tam-phone-b');
  const left = await names();
  ok(
    "a phone's list without its hero retires that one, never the other phone's",
    gone.body.retired === 1 &&
      JSON.stringify(left) === JSON.stringify([`OnA${sfx}`]),
    [gone.body, left],
  );
}

// ---- 4. The rules checker down: the realm still goes up and waits to be checked.
{
  const now = await call('GET', '/api/realm', { token: rae!.token });
  await sh(['docker', 'stop', 'gravoth-validator']);
  const down = await upload(rae!.token, {
    deviceId: 'phone',
    baseRevision: now.body.revision,
    data: raeRealm,
    reason: 'interval',
  });
  await Bun.sleep(1500);
  const waiting = await call('GET', '/api/realm', { token: rae!.token });
  ok(
    'with the checker down the realm still goes up, and waits to be checked',
    down.status === 200 && waiting.body.checkedRevision < waiting.body.revision,
    [down.body, waiting.body.checkedRevision],
  );
  await sh(['docker', 'start', 'gravoth-validator']);
  for (let i = 0; i < 60; i++) {
    if ((await call('GET', '/api/health')).body.validator === 'up') break;
    await Bun.sleep(500);
  }
  const again = await upload(rae!.token, {
    deviceId: 'phone',
    baseRevision: waiting.body.revision,
    data: raeRealm,
    reason: 'interval',
  });
  const caught = await checkedRealm(rae!.token);
  ok(
    'the next upload with the checker back is checked, and the hero that left the realm is retired',
    again.status === 200 &&
      caught.body.checkedRevision === caught.body.revision &&
      caught.body.heroes.length === 2,
    caught.body.heroes,
  );
}

console.log(failed === 0 ? '\nall passed' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
