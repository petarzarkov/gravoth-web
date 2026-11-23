// `bun run e2e` (e2e/run.sh): end to end over the local production stack (compose.prod.yml + e2e/compose.e2e.yml): the game's calls (bearer tokens),
// mails read back from the API's log, the rules checker on a real save, the online realm (decision 227: the lease,
// revisions, transfers, and the boards and player pages it feeds, read by the real checker from saves the game's Core
// wrote), friends, privacy, deletion, degraded services, and a backup restored into a scratch database, the cloud saves
// e2e/saves.e2e.ts kept among them. Prints one line per check; exits 1 if any failed.
const base = 'http://localhost:3000';
const save = await Bun.file(`${import.meta.dir}/.tmp/save.txt`).text();
const run = `${Date.now().toString(36)}`;
/** A suffix for the realms' heroes, so a rerun on a kept stack (KEEP=1) tells them apart. */
const sfx = run.slice(-3);
/** An online realm the save generator wrote (e2e/savegen), its heroes renamed as asked, as base64 for `PUT /api/realm`. */
const realmFile = async (
  file: string,
  renames: Record<string, string> = {},
) => {
  let text = await Bun.file(`${import.meta.dir}/.tmp/${file}.txt`).text();
  for (const [from, to] of Object.entries(renames))
    text = text.replace(new RegExp(`^name ${from}$`, 'm'), `name ${to}`);
  return Buffer.from(text).toString('base64');
};
/** The game's own header (decision 223), which also names its version for the checker's build snapshots. */
const GAME = { 'x-gravoth-client': 'game/0.13.1' };
let failed = 0;
const ok = (name: string, cond: boolean, detail: unknown = '') => {
  if (!cond) failed++;
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`,
  );
};

type Reply = {
  status: number;
  body: any;
  token: string | null;
  headers: Headers;
};
const call = async (
  method: string,
  path: string,
  opts: {
    token?: string;
    body?: unknown;
    form?: Record<string, string>;
    redirect?: RequestRedirect;
    ip?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<Reply> => {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.ip) headers['cf-connecting-ip'] = opts.ip;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (opts.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(opts.form).toString();
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body,
    redirect: opts.redirect ?? 'manual',
  });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = text === '' ? {} : JSON.parse(text);
  } catch {}
  return {
    status: res.status,
    body: parsed,
    token: res.headers.get('set-auth-token'),
    headers: res.headers,
  };
};
const sh = async (cmd: string[]) => {
  const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { code: await p.exited, out, err };
};
/** One value from the live database (or another on the same Postgres). */
const psql = async (query: string, db = 'gravoth') =>
  (
    await sh([
      'docker',
      'exec',
      'gravoth-postgres',
      'psql',
      '-U',
      'gravoth',
      '-d',
      db,
      '-tAc',
      query,
    ])
  ).out.trim();
/** The newest logged mail with this subject since `since`, and the links in it. */
const mail = async (subject: RegExp, since: string) => {
  for (let i = 0; i < 20; i++) {
    const window = new Date(Date.parse(since) - 3000).toISOString();
    const { out, err } = await sh([
      'docker',
      'logs',
      '--since',
      window,
      'gravoth-api',
    ]);
    const lines = (out + err)
      .split('\n')
      .filter((l) => l.includes('"email body"'));
    for (const line of lines.reverse()) {
      const entry = JSON.parse(line);
      if (entry.timestamp >= since && subject.test(entry.subject)) {
        const links = [...String(entry.html).matchAll(/href="([^"]+)"/g)].map(
          (m) => m[1]!.replaceAll('&amp;', '&'),
        );
        return {
          subject: entry.subject as string,
          html: entry.html as string,
          links,
        };
      }
    }
    await Bun.sleep(250);
  }
  return undefined;
};
const now = () => new Date().toISOString();

const build = (level: number, revision: number, dps = 12_000) => ({
  revision,
  gameVersion: '0.12.0',
  level,
  skills: [
    {
      id: 'cleave',
      level: 18,
      slot: 0,
      supports: [{ id: 'melee_phys', level: 15 }],
    },
  ],
  gear: [
    {
      slot: 'MainHand',
      name: 'Grief Cleaver',
      base: 'Great Axe',
      rarity: 'Rare',
      itemLevel: 50,
      lines: [{ text: '+42 to Strength', kind: 'suffix', tier: 2 }],
    },
  ],
  talents: { allocated: [1, 2, 3] },
  summary: { dps, clearDps: dps * 0.8, ehp: 20_000, life: 3_000 },
});
let nextIp = 10;
const signUp = async (
  name: string,
  email: string,
  password = 'a long enough password',
  token?: string,
) => {
  const r = await call('POST', '/api/auth/sign-up/email', {
    body: { name, email, password },
    ip: `198.51.100.${nextIp++}`,
    ...(token ? { token } : {}),
  });
  return { ...r, id: r.body?.user?.id as string };
};

// ---- 0. The stack.
{
  const h = await call('GET', '/api/health');
  ok(
    'health: Postgres and the rules checker up',
    h.body.database === 'up' && h.body.validator === 'up',
    h.body,
  );
  const page = await fetch(`${base}/boards/pit_floor`, {
    headers: { accept: 'text/html' },
  });
  ok(
    'the website is served at a board path, with its policy',
    page.status === 200 &&
      (page.headers.get('content-security-policy') ?? '').includes(
        "script-src 'self'",
      ),
  );
  const methods = await call('GET', '/api/account/methods');
  ok(
    'sign-in methods without OAuth clients: guest and email only',
    JSON.stringify(methods.body.methods) === '["guest","email"]',
    methods.body,
  );
}

// ---- 1. A guest, as the game makes one, then upgraded to an account.
let guestHeroId = '';
{
  const g = await call('POST', '/api/auth/sign-in/anonymous', {
    body: {},
    ip: '198.51.100.9',
  });
  ok(
    'guest sign-in gives a bearer token',
    g.status === 200 && g.token !== null,
    g.status,
  );
  const gt = g.token!;
  const prof = await call('GET', '/api/profile', { token: gt });
  ok(
    'a guest gets a profile with a made-up name',
    prof.status === 200 && /^Guest/.test(prof.body.displayName),
    prof.body,
  );
  const hero = await call('POST', '/api/heroes', {
    token: gt,
    body: { name: `Guesty${run.slice(-3)}`, class: 'Ranger' },
  });
  guestHeroId = hero.body.hero?.id;
  ok(
    'a guest registers a hero',
    hero.status === 200 && hero.body.created === true,
    hero.body,
  );
  const friend = await call('POST', '/api/friends/requests', {
    token: gt,
    body: { displayName: 'Nobody123' },
  });
  ok(
    'a guest has no friends list',
    friend.status === 403 || friend.body.error === 'GUEST_ACCOUNT',
    friend.body,
  );
  const up = await signUp(
    'Upgraded',
    `up-${run}@example.test`,
    'a long enough password',
    gt,
  );
  ok(
    'the guest signs up with its token',
    up.status === 200 && up.token !== null,
    up.body,
  );
  const heroes = await call('GET', '/api/heroes', { token: up.token! });
  ok(
    "the guest's hero moved to the new account",
    heroes.body.heroes?.some((h: any) => h.id === guestHeroId),
    heroes.body,
  );
  const old = await call('GET', '/api/profile', { token: gt });
  ok("the guest's own token no longer works", old.status === 401, old.status);
}

// ---- 2. Email accounts: confirm the address from the mail, reset the password from the mail.
const pw = 'a long enough password';
const players: Record<
  string,
  { token: string; id: string; email: string; name: string }
> = {};
for (const who of ['Ana', 'Bo', 'Cy']) {
  const email = `${who.toLowerCase()}-${run}@example.test`;
  const since = now();
  const r = await signUp(who, email);
  ok(`${who} signs up`, r.status === 200 && r.token !== null, r.body);
  const name = `${who}${run.slice(-5)}`;
  const renamed = await call('PATCH', '/api/profile', {
    token: r.token!,
    body: { displayName: name },
  });
  ok(
    `${who} picks a display name`,
    renamed.status === 200 &&
      renamed.body.displayName === name &&
      renamed.body.nameChosen === true,
    renamed.body,
  );
  players[who] = { token: r.token!, id: r.id, email, name };
  if (who === 'Bo') {
    ok(
      'an email account starts on a portrait, with no photo to offer',
      renamed.body.avatar?.kind === 'portrait' &&
        typeof renamed.body.avatar?.portrait === 'string' &&
        renamed.body.avatar?.url === null &&
        renamed.body.hasProviderPhoto === false,
      renamed.body.avatar,
    );
    const photo = await call('PATCH', '/api/profile', {
      token: r.token!,
      body: { avatar: 'provider' },
    });
    ok(
      'and is refused the photo it has not got',
      photo.status === 409 && photo.body.error === 'NO_PROVIDER_PHOTO',
      photo.body,
    );
    const picked = await call('PATCH', '/api/profile', {
      token: r.token!,
      body: { avatar: 'gravelord' },
    });
    ok(
      'picks another portrait',
      picked.status === 200 && picked.body.avatar?.portrait === 'gravelord',
      picked.body,
    );
  }
  if (who === 'Ana') {
    const m = await mail(/Confirm your Gravoth account/, since);
    ok(
      'the confirmation mail is sent, with its link',
      m !== undefined &&
        m.links.some((l) => l.includes('/api/auth/verify-email?token=')),
      m?.links,
    );
    const link = m!.links.find((l) => l.includes('/verify-email'))!;
    const follow = await fetch(link.replace('http://localhost:3000', base), {
      redirect: 'follow',
    });
    const text = await follow.text();
    ok(
      'the link confirms the address and lands on the confirmation page',
      follow.status === 200 && /confirmed/i.test(text),
      `${follow.status} ${text.slice(0, 120)}`,
    );
    const acct = await call('GET', '/api/account', { token: r.token! });
    ok(
      'the account shows the address confirmed',
      acct.body.emailVerified === true,
      acct.body,
    );
  }
}
{
  const since = now();
  await call('POST', '/api/auth/request-password-reset', {
    body: { email: players.Bo!.email },
  });
  const m = await mail(/password/i, since);
  const link = m?.links.find((l) =>
    l.includes('/api/account/reset-password?token='),
  );
  ok(
    'the reset mail is sent, with its link to the reset page',
    link !== undefined,
    m?.links,
  );
  const formPage = await fetch(link!.replace('http://localhost:3000', base));
  ok(
    'the reset page opens',
    formPage.status === 200 && (await formPage.text()).includes('newPassword'),
    formPage.status,
  );
  const token = new URL(link!).searchParams.get('token')!;
  const reset = await call('POST', '/api/account/reset-password', {
    form: { token, newPassword: 'a brand new password' },
  });
  ok(
    'the reset form sets the new password',
    reset.status === 200,
    `${reset.status} ${String(reset.body).slice(0, 100)}`,
  );
  const oldSession = await call('GET', '/api/profile', {
    token: players.Bo!.token,
  });
  ok(
    "the reset ends Bo's other sessions",
    oldSession.status === 401,
    oldSession.status,
  );
  const withOld = await call('POST', '/api/auth/sign-in/email', {
    body: { email: players.Bo!.email, password: pw },
    ip: '198.51.100.50',
  });
  ok(
    'the old password no longer signs in',
    withOld.status === 401,
    withOld.status,
  );
  const withNew = await call('POST', '/api/auth/sign-in/email', {
    body: { email: players.Bo!.email, password: 'a brand new password' },
    ip: '198.51.100.51',
  });
  ok(
    'the new password signs in',
    withNew.status === 200 && withNew.token !== null,
    withNew.status,
  );
  players.Bo!.token = withNew.token!;
}

// ---- 3. Records with a real save: the rules checker reads it with the game's Core.
{
  const ana = players.Ana!;
  const ash = await call('POST', '/api/heroes', {
    token: ana.token,
    body: { name: 'Ashgrove', class: 'barbarian' },
  });
  const wren = await call('POST', '/api/heroes', {
    token: ana.token,
    body: { name: 'Wren', class: 'barbarian' },
  });
  ok(
    "Ana's two heroes are registered",
    ash.status === 200 && wren.status === 200,
  );
  const s1 = await call('POST', '/api/leaderboards/chart_tier/scores', {
    token: ana.token,
    body: {
      heroId: ash.body.hero.id,
      score: 9,
      build: build(58, 1),
      save,
      saveHeroId: 1,
    },
  });
  ok(
    'a tier 9 record the save backs is verified, and on no board: Ashgrove is offline (decision 227)',
    s1.status === 200 &&
      s1.body.entry?.verdict === 'verified' &&
      s1.body.entry.rank === null,
    s1.body,
  );
  const card = await call('GET', `/api/builds/${s1.body.entry?.buildId}`);
  ok(
    "the build card carries the checker's own pages and numbers",
    card.status === 200 &&
      Array.isArray(card.body.card) &&
      card.body.card.length > 0 &&
      card.body.dps !== 12_000,
    { pages: card.body.card?.length, dps: card.body.dps },
  );
  const s2 = await call('POST', '/api/leaderboards/chart_tier/scores', {
    token: ana.token,
    body: {
      heroId: wren.body.hero.id,
      score: 12,
      build: build(44, 1),
      save,
      saveHeroId: 2,
    },
  });
  ok(
    'a tier 12 claim on a tier 3 save is flagged and hidden',
    s2.status === 200 &&
      s2.body.check?.verdict === 'flagged' &&
      s2.body.entry?.rank === null,
    s2.body,
  );
  const s3 = await call('POST', '/api/leaderboards/chart_tier/scores', {
    token: ana.token,
    body: {
      heroId: wren.body.hero.id,
      score: 3,
      build: build(44, 2),
      save,
      saveHeroId: 2,
    },
  });
  ok(
    "Wren's honest tier 3 replaces the flagged entry",
    s3.body.result === 'improved' && s3.body.entry?.verdict === 'verified',
    s3.body,
  );
  const s5 = await call('POST', '/api/leaderboards/chart_tier/scores', {
    token: ana.token,
    body: {
      heroId: ash.body.hero.id,
      score: 13,
      build: build(58, 3),
      save,
      saveHeroId: 1,
    },
  });
  ok(
    "a flagged tier 13 claim leaves Ashgrove's verified 9 standing",
    s5.body.result === 'kept' &&
      s5.body.check?.verdict === 'flagged' &&
      s5.body.entry?.score === 9 &&
      s5.body.entry.verdict === 'verified',
    s5.body,
  );
  const s6 = await call('POST', '/api/leaderboards/marks/scores', {
    token: ana.token,
    body: {
      heroId: ash.body.hero.id,
      score: 400,
      build: build(50, 4),
      save,
      saveHeroId: 1,
    },
  });
  ok(
    'a level that contradicts the save is flagged',
    s6.body.check?.verdict === 'flagged' &&
      /level 58/.test(s6.body.check?.note ?? ''),
    s6.body.check,
  );
  const s4 = await call('POST', '/api/leaderboards/pit_floor/scores', {
    token: ana.token,
    body: { heroId: ash.body.hero.id, score: 140, build: build(58, 2) },
  });
  ok(
    'a record with no save is pending',
    s4.body.entry?.verdict === 'pending' && s4.body.entry.rank === null,
    s4.body.entry,
  );
  const board = await call('GET', '/api/leaderboards/chart_tier?take=50');
  ok(
    "the boards show none of the offline heroes' records, v0.13.0's score route answered all the same",
    board.status === 200 &&
      board.body.entries.data.every((e: any) => e.player.userId !== ana.id),
    board.body.entries,
  );
  const dup = await call('POST', '/api/leaderboards/pit_floor/scores', {
    token: ana.token,
    body: {
      heroId: ash.body.hero.id,
      score: 150,
      build: { ...build(58, 2), level: 59 },
    },
  });
  ok(
    'a changed build under a used revision is refused',
    dup.status === 409,
    dup.body,
  );
  const hc = await call('POST', '/api/leaderboards/hc_pit_floor/scores', {
    token: ana.token,
    body: { heroId: ash.body.hero.id, score: 10, build: build(58, 3) },
  });
  ok(
    "a normal hero's record on a hardcore board is refused",
    hc.status === 422,
    hc.body,
  );
}

/** The realm once the rules checker has read its latest revision. */
const checkedRealm = async (token: string) => {
  let r = await call('GET', '/api/realm', { token });
  for (let i = 0; i < 80 && r.body.checkedRevision !== r.body.revision; i++) {
    await Bun.sleep(250);
    r = await call('GET', '/api/realm', { token });
  }
  return r;
};
/** A player's realm, first upload: the lease, then revision 1, then the checker's read. */
const firstRealm = async (token: string, data: string) => {
  await call('POST', '/api/realm/lease', {
    token,
    body: { deviceId: 'phone' },
  });
  const up = await call('PUT', '/api/realm', {
    token,
    headers: GAME,
    body: { deviceId: 'phone', baseRevision: 0, data, reason: 'create' },
  });
  return { up, read: await checkedRealm(token) };
};

// ---- 3b. Ana's online realm (decision 227; e2e/realm.e2e.ts drives the lease, revisions and transfers): the boards take
// its records, read by the rules checker from the save the game's Core wrote, and none of the offline heroes'.
{
  const ana = players.Ana!;
  const { up, read } = await firstRealm(
    ana.token,
    await realmFile('realm-ana'),
  );
  ok(
    "Ana's realm goes up and the checker reads it: Ashgrove and Wren online, neither flagged",
    up.status === 200 &&
      read.body.checkedRevision === 1 &&
      JSON.stringify(
        read.body.heroes.map((h: any) => [h.name, h.level, h.flagged]),
      ) ===
        JSON.stringify([
          ['Ashgrove', 58, false],
          ['Wren', 44, false],
        ]),
    [up.body, read.body.heroes],
  );
  const pit = await call('GET', '/api/leaderboards/pit_floor?take=100');
  const mine = pit.body.entries.data.filter(
    (e: any) => e.player.userId === ana.id,
  );
  ok(
    "the board shows Ashgrove's floor 70 from the realm, verified, and not the offline 140",
    mine.length === 1 &&
      mine[0].hero.name === 'Ashgrove' &&
      mine[0].score === 70 &&
      mine[0].verdict === 'verified' &&
      mine[0].build.level === 58,
    mine,
  );
}

// ---- 4. Friends, blocks and privacy.
{
  const { Ana: ana, Bo: bo, Cy: cy } = players as Required<typeof players>;
  const since = now();
  const ask = await call('POST', '/api/friends/requests', {
    token: bo!.token,
    body: { displayName: ana!.name.toUpperCase() },
  });
  ok(
    'Bo asks Ana by name, any case',
    ask.status === 200 && ask.body.status === 'pending',
    ask.body,
  );
  const m = await mail(/friend/i, since);
  ok(
    'Ana (address confirmed) gets a friend request mail',
    m !== undefined,
    m?.subject,
  );
  const incoming = await call('GET', '/api/friends/requests/incoming', {
    token: ana!.token,
  });
  ok(
    "Ana sees Bo's request",
    incoming.body.data?.[0]?.displayName === bo!.name,
    incoming.body,
  );
  const accept = await call(
    'POST',
    `/api/friends/requests/${incoming.body.data[0].id}/accept`,
    { token: ana!.token },
  );
  ok(
    'Ana accepts',
    accept.status === 200 && accept.body.displayName === bo!.name,
    accept.body,
  );
  const unconfirmed = now();
  await call('POST', '/api/friends/requests', {
    token: ana!.token,
    body: { displayName: cy!.name },
  });
  ok(
    'Cy (address not confirmed) gets no mail',
    (await mail(/friend/i, unconfirmed)) === undefined,
  );
  const cyIn = await call('GET', '/api/friends/requests/incoming', {
    token: cy!.token,
  });
  await call(
    'POST',
    `/api/friends/requests/${cyIn.body.data?.[0]?.id}/decline`,
    { token: cy!.token },
  );
  // Bo's and Cy's online heroes, on the boards from their realms.
  for (const [who, file, hero] of [
    [bo!, 'realm-bo', 'Bodhi'],
    [cy!, 'realm-cy', 'Cyril'],
  ] as const) {
    const { up, read } = await firstRealm(
      who.token,
      await realmFile(file, { [hero]: `${hero}${sfx}` }),
    );
    ok(
      `${hero}${sfx} is online from ${who.name}'s realm`,
      up.status === 200 && read.body.heroes[0]?.name === `${hero}${sfx}`,
      [up.body, read.body.heroes],
    );
  }
  const fview = await call(
    'GET',
    '/api/leaderboards/pit_floor?view=friends&take=50',
    { token: ana!.token },
  );
  const fnames = fview.body.entries?.data.map((e: any) => e.hero.name) ?? [];
  ok(
    "Ana's friends view: her and Bo's heroes, not Cy's",
    fnames.includes('Ashgrove') &&
      fnames.includes(`Bodhi${sfx}`) &&
      !fnames.includes(`Cyril${sfx}`),
    fnames,
  );
  const me = await call('GET', '/api/leaderboards/pit_floor/me?around=1', {
    token: ana!.token,
  });
  ok(
    "Ana's place on the board with her neighbours",
    me.body.entry?.hero.name === 'Ashgrove' && me.body.neighbours.length >= 2,
    me.body.entry,
  );
  const block = await call('POST', '/api/blocks', {
    token: ana!.token,
    body: { displayName: cy!.name },
  });
  ok('Ana blocks Cy', block.status === 200, block.body);
  const cyAsks = await call('POST', '/api/friends/requests', {
    token: cy!.token,
    body: { displayName: ana!.name },
  });
  ok('to Cy, Ana is no player at all', cyAsks.status === 404, cyAsks.body);
  await call('PATCH', '/api/profile', {
    token: bo!.token,
    body: { publicProfile: false },
  });
  const pub = await call('GET', '/api/leaderboards/pit_floor?take=50');
  const boRow = pub.body.entries.data.find(
    (e: any) => e.hero.name === `Bodhi${sfx}`,
  );
  ok(
    'a private profile shows as hidden to the public, without its picture',
    boRow?.player.hidden === true &&
      boRow.player.displayName !== bo!.name &&
      boRow.player.avatar === null,
    boRow?.player,
  );
  const own = await call('GET', '/api/leaderboards/pit_floor?take=50', {
    token: bo!.token,
  });
  const ownRow = own.body.entries.data.find(
    (e: any) => e.hero.name === `Bodhi${sfx}`,
  );
  ok(
    '…and as their own name and picture to themselves',
    ownRow?.player.displayName === bo!.name &&
      ownRow?.player.avatar?.portrait === 'gravelord',
    ownRow?.player,
  );
  const bad = await call(
    'GET',
    '/api/leaderboards/pit_floor?cursor=not-a-cursor',
  );
  ok('a bad cursor is a 400, not a 500', bad.status === 400, bad.status);
}

// ---- 5. Degraded services: the rules checker and Redis down.
{
  await sh(['docker', 'stop', 'gravoth-validator']);
  const ana = players.Ana!;
  const h = await call('GET', '/api/health');
  ok(
    'health reports the checker down and still answers 200',
    h.status === 200 && h.body.validator === 'down',
    h.body,
  );
  const hero = await call('POST', '/api/heroes', {
    token: ana.token,
    body: { name: 'Ashgrove', class: 'barbarian' },
  });
  const s = await call('POST', '/api/leaderboards/marks/scores', {
    token: ana.token,
    body: {
      heroId: hero.body.hero.id,
      score: 500,
      build: build(58, 10),
      save,
      saveHeroId: 1,
    },
  });
  ok(
    'with the checker down a record waits as pending',
    s.status === 200 && s.body.entry?.verdict === 'pending',
    s.body.entry,
  );
  await sh(['docker', 'start', 'gravoth-validator']);
  await sh(['docker', 'stop', 'gravoth-redis']);
  const b = await call('GET', '/api/leaderboards');
  const p = await call('GET', '/api/profile', { token: ana.token });
  ok(
    'with Redis down the boards and the profile still answer',
    b.status === 200 && p.status === 200,
    [b.status, p.status],
  );
  await sh(['docker', 'start', 'gravoth-redis']);
}

// ---- 6. Deleting an account deletes everything it had.
{
  const cy = players.Cy!;
  const confirm = now();
  await call('POST', '/api/auth/send-verification-email', {
    token: cy.token,
    body: { email: cy.email },
  });
  const cm = await mail(/Confirm your Gravoth account/, confirm);
  const link = cm?.links.find((l) => l.includes('/verify-email'));
  if (link) await fetch(link, { redirect: 'follow' });
  ok(
    'Cy asks for a new confirmation link and confirms',
    (await call('GET', '/api/account', { token: cy.token })).body
      .emailVerified === true,
    cm?.links,
  );
  const cySave = await call('PUT', '/api/saves/me', {
    token: cy.token,
    body: { data: 'AAD/gAAA', description: 'Cyril' },
  });
  ok('Cy keeps a cloud save', cySave.status === 200, cySave.body);
  const since = now();
  const wrong = await call('POST', '/api/account/delete', {
    token: cy.token,
    body: { password: 'not the password' },
  });
  ok(
    'deleting needs the right password',
    wrong.status === 401 ||
      wrong.status === 403 ||
      wrong.body.error === 'INVALID_PASSWORD',
    wrong.body,
  );
  const del = await call('POST', '/api/account/delete', {
    token: cy.token,
    body: { password: pw },
  });
  ok(
    'Cy deletes the account',
    del.status === 200 && del.body.deleted === true,
    del.body,
  );
  const m = await mail(/deleted/i, since);
  ok('a goodbye mail is sent', m !== undefined, m?.subject);
  const board = await call('GET', '/api/leaderboards/pit_floor?take=50');
  ok(
    "Cy's hero and record are gone from the board",
    !board.body.entries.data.some((e: any) => e.hero.name === `Cyril${sfx}`),
  );
  const signIn = await call('POST', '/api/auth/sign-in/email', {
    body: { email: cy.email, password: pw },
    ip: '198.51.100.52',
  });
  ok(
    'the deleted account cannot sign in',
    signIn.status === 401,
    signIn.status,
  );
  ok(
    "Cy's cloud save went with the account",
    (await psql(
      `select count(*) from cloud_saves where user_id = '${cy.id}'`,
    )) === '0',
  );
  ok(
    "Cy's online realm went with the account",
    (await psql(`select count(*) from realms where user_id = '${cy.id}'`)) ===
      '0',
  );
}

// ---- 7. A backup now, then the restore drill into a scratch database.
{
  const b = await sh([
    'docker',
    'exec',
    'gravoth-api',
    'bun',
    'scripts/backup-now.ts',
  ]);
  const result = JSON.parse(
    b.out
      .trim()
      .split('\n')
      .filter((l) => l.startsWith('{"status"'))
      .pop() ?? '{}',
  );
  ok(
    'a backup now writes a dump to the bucket',
    b.code === 0 && result.status === 'done' && result.bytes > 1000,
    result,
  );
  const file = `${import.meta.dir}/.tmp/restore.dump`;
  const res = await fetch(
    `http://127.0.0.1:9090/gravoth-backups/${result.key}`,
  );
  await Bun.write(file, await res.arrayBuffer());
  ok(
    'the dump downloads from the bucket',
    res.status === 200 && Bun.file(file).size === result.bytes,
    [res.status, Bun.file(file).size],
  );
  await sh(['docker', 'cp', file, 'gravoth-postgres:/tmp/gravoth.dump']);
  await sh([
    'docker',
    'exec',
    'gravoth-postgres',
    'dropdb',
    '-U',
    'gravoth',
    '--if-exists',
    'gravoth_drill',
  ]);
  await sh([
    'docker',
    'exec',
    'gravoth-postgres',
    'createdb',
    '-U',
    'gravoth',
    'gravoth_drill',
  ]);
  const restore = await sh([
    'docker',
    'exec',
    'gravoth-postgres',
    'pg_restore',
    '--no-owner',
    '-U',
    'gravoth',
    '-d',
    'gravoth_drill',
    '/tmp/gravoth.dump',
  ]);
  ok(
    'pg_restore reads it into a scratch database',
    restore.code === 0,
    restore.err.slice(0, 300),
  );
  const count = async (db: string, table: string) =>
    Number(await psql(`select count(*) from ${table}`, db));
  for (const table of [
    'users',
    'profiles',
    'heroes',
    'hero_builds',
    'leaderboard_entries',
    'friendships',
    'blocks',
    'cloud_saves',
    'realms',
    'realm_transfers',
    // Decision 228's chat (e2e/chat.e2e.ts runs first, so these hold rows).
    'chat_messages',
    'chat_reads',
    'chat_reports',
    'chat_mutes',
    // Decision 229's hidden suggestions (e2e/suggestions.e2e.ts runs first, so this holds a row).
    'suggestion_dismissals',
  ]) {
    const [live, drill] = [
      await count('gravoth', table),
      await count('gravoth_drill', table),
    ];
    ok(
      `restored ${table}: ${drill} rows, as live`,
      live === drill && live >= 0,
      { live, drill },
    );
  }
  const saves = await psql(
    `select count(*) || ' ' || count(*) filter (where octet_length(data) = size and encode(sha256(data), 'hex') = sha256) from cloud_saves`,
    'gravoth_drill',
  );
  ok(
    'the restored cloud saves are the same bytes, by size and hash',
    /^([1-9][0-9]*) \1$/.test(saves),
    saves,
  );
  const trigger = await sh([
    'docker',
    'exec',
    'gravoth-postgres',
    'psql',
    '-U',
    'gravoth',
    '-d',
    'gravoth_drill',
    '-tAc',
    'update hero_builds set level = level + 1',
  ]);
  ok(
    'the restored database still refuses changing a build',
    trigger.code !== 0,
    trigger.out + trigger.err,
  );
  await sh([
    'docker',
    'exec',
    'gravoth-postgres',
    'dropdb',
    '-U',
    'gravoth',
    'gravoth_drill',
  ]);
}

console.log(failed === 0 ? '\nall passed' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
