// `bun run e2e` (e2e/run.sh): the website driven like a person, in headless Chrome over the DevTools protocol, against
// the local stack. Screenshots of the account (its cloud save too), friends (their suggestions too), board, build, player, chat moderation and
// delete pages land in e2e/.tmp/ui.
// The site as Cloudflare Pages serves it (e2e/pages.ts) on one origin, the API on another, as in production.
const base = 'http://localhost:3001';
const apiBase = 'http://localhost:3000';
const out = `${import.meta.dir}/.tmp/ui`;
const run = Date.now().toString(36).slice(-5);
let failed = 0;
const ok = (name: string, cond: boolean, detail: unknown = '') => {
  if (!cond) failed++;
  console.log(
    `${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${JSON.stringify(detail)}`}`,
  );
};

// Eli, the other player, made through the API.
const api = async (
  method: string,
  path: string,
  body?: unknown,
  token?: string,
) => {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': `203.0.113.${(Date.now() % 200) + 20}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: res.status,
    body: await res.json().catch(() => ({})),
    token: res.headers.get('set-auth-token'),
  };
};
const eli = await api('POST', '/api/auth/sign-up/email', {
  name: 'Eli',
  email: `eli-${run}@example.test`,
  password: 'a long enough password',
});
const eliName = `Eli${run}`;
const eliId: string = eli.body.user?.id;
await api('PATCH', '/api/profile', { displayName: eliName }, eli.token!);

const port = 9400 + (Date.now() % 500);
process.on('exit', () => chrome?.kill());
await Bun.$`rm -rf ${out}`.quiet();
await Bun.$`mkdir -p ${out}`.quiet();
var chrome = Bun.spawn(
  [
    Bun.env['CHROME'] ?? 'google-chrome',
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${out}/profile`,
    '--no-first-run',
    '--disable-gpu',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdout: 'ignore', stderr: 'ignore' },
);
let page: any;
for (let i = 0; i < 50 && !page; i++) {
  await Bun.sleep(200);
  try {
    page = (
      (await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json()) as any[]
    ).find((t) => t.type === 'page');
  } catch {}
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map<number, (v: any) => void>();
const problems: string[] = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id) pending.get(m.id)?.(m.result ?? m.error);
  else if (m.method === 'Runtime.exceptionThrown')
    problems.push(
      m.params.exceptionDetails.exception?.description ??
        m.params.exceptionDetails.text,
    );
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    problems.push(
      m.params.args.map((a: any) => a.value ?? a.description).join(' '),
    );
  else if (
    m.method === 'Log.entryAdded' &&
    m.params.entry.level === 'error' &&
    !/status of 40[134]/.test(m.params.entry.text)
  )
    problems.push(m.params.entry.text);
});
const send = (method: string, params: object = {}) =>
  new Promise<any>((r) => {
    const n = ++id;
    pending.set(n, r);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const js = async (expression: string) => {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails)
    throw new Error(
      r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
    );
  return r.result?.value;
};
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});

// Helpers inside the page: type like a person (React's own setter and an input event), click by visible text, wait.
const helpers = `
  window.__t = {
    type(selector, value, index = 0) {
      const el = document.querySelectorAll(selector)[index];
      if (!el) throw new Error('no ' + selector);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    click(text, scope = 'button, a, label') {
      const el = [...document.querySelectorAll(scope)].find((e) => e.textContent.trim() === text);
      if (!el) throw new Error('no ' + scope + ' reading ' + text);
      el.click();
    },
    text() { return document.body.innerText; },
    async until(test, ms = 5000) {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (test()) return true; await new Promise((r) => setTimeout(r, 100)); }
      return false;
    },
  };`;
const go = async (path: string) => {
  await send('Page.navigate', { url: `${base}${path}` });
  await Bun.sleep(600);
  await js(helpers);
  // The page is up once the app rendered something other than its spinner.
  await js(
    `__t.until(() => document.querySelector('main') && !document.querySelector('.spinner'), 8000)`,
  );
};
const until = (test: string, ms = 5000) =>
  js(`__t.until(() => ${test}, ${ms})`);
const shot = async (name: string) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  await Bun.write(`${out}/${name}.png`, Buffer.from(r.data, 'base64'));
};
const desktop = () =>
  send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
const phone = () =>
  send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
/** The whole page at the current width, for the record (e2e/.tmp/ui). */
const fullShot = async (name: string) => {
  await Bun.sleep(400);
  const r = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  await Bun.write(`${out}/${name}.png`, Buffer.from(r.data, 'base64'));
};
const has = (text: string) => `__t.text().includes(${JSON.stringify(text)})`;
/** One element of the page, with a margin round it, at the current width (e2e/.tmp/ui). */
const elementShot = async (name: string, selector: string) => {
  const element = `document.querySelector(${JSON.stringify(selector)})`;
  await js(`${element}.scrollIntoView({ block: 'center' })`);
  await Bun.sleep(400);
  const box = await js(
    `(() => { const r = ${element}.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`,
  );
  const margin = 16;
  const r = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: {
      x: Math.max(0, box.x - margin),
      y: Math.max(0, box.y - margin),
      width: box.width + 2 * margin,
      height: box.height + 2 * margin,
      scale: 1,
    },
  });
  await Bun.write(`${out}/${name}.png`, Buffer.from(r.data, 'base64'));
};

const email = `dara-${run}@example.test`;
const darName = `Dara${run}`;

// 0. The landing page, the privacy policy and the deletion page, readable signed out.
await go('/');
ok(
  'the home page says what Gravoth is, with the Play link',
  await until(
    `${has('What Gravoth is')} && !!document.querySelector('a[href*="play.google.com/store/apps/details?id=com.petarzarkov.gravoth"]')`,
  ),
);
ok(
  'its screenshots load',
  await js(
    `Promise.all([...document.querySelectorAll('.shot img')].map(i => i.decode().then(() => i.naturalWidth > 0, () => false))).then(r => r.length === 8 && r.every(Boolean))`,
  ),
);
const privacy = await fetch(`${base}/privacy/`);
const privacyText = await privacy.text();
ok(
  'the privacy policy is a page of its own at /privacy/',
  privacy.status === 200 &&
    privacyText.includes('com.petarzarkov.gravoth') &&
    (privacy.headers.get('content-security-policy') ?? '').includes(
      "'unsafe-inline'",
    ),
  privacy.status,
);
const terms = await fetch(`${base}/terms/`);
const termsText = await terms.text();
ok(
  'the terms of service are a page of their own at /terms/',
  terms.status === 200 &&
    termsText.includes('Gravoth Terms of Service') &&
    (terms.headers.get('content-security-policy') ?? '').includes(
      "default-src 'none'",
    ),
  terms.status,
);
const home = await fetch(`${base}/`);
ok(
  "the site's pages carry the strict policy, allowing calls to the API",
  (home.headers.get('content-security-policy') ?? '').includes(
    `connect-src 'self' ${apiBase}`,
  ),
);
await go('/delete-account');
ok(
  'the account deletion page explains it without signing in',
  await until(has('Without signing in')),
);
const preflight = await fetch(`${apiBase}/api/profile`, {
  method: 'OPTIONS',
  headers: {
    origin: base,
    'access-control-request-method': 'PATCH',
    'access-control-request-headers': 'content-type',
  },
});
ok(
  "the API allows the site's credentialed calls across origins",
  preflight.headers.get('access-control-allow-origin') === base &&
    preflight.headers.get('access-control-allow-credentials') === 'true',
  [preflight.status, preflight.headers.get('access-control-allow-origin')],
);

// 1. Create an account through the form, behind "Continue with email".
await go('/sign-in');
ok(
  "the sign-in page offers its ways in as dark buttons, email with Gravoth's icon",
  await until(
    `[...document.querySelectorAll('button.way-in')].some(b => b.textContent.trim() === 'Continue with email' && b.querySelector('img[src="/img/icon-192.png"]'))`,
  ),
  await js(
    `[...document.querySelectorAll('button.way-in')].map(b => b.textContent.trim())`,
  ),
);
await js(
  `Promise.all([...document.querySelectorAll('.way-in img')].map(i => i.decode().then(() => true, () => false)))`,
);
await fullShot('sign-in');
await phone();
await go('/sign-in');
await fullShot('sign-in-phone');
await desktop();
await go('/sign-in');
await js(`__t.click('Continue with email')`);
ok(
  'continuing with email opens the form on its email box',
  await until(
    `!!document.querySelector('input[type=email]') && document.activeElement === document.querySelector('input[type=email]')`,
  ),
);
await js(`__t.click('Create account')`);
ok(
  'the sign-up form links the terms of service and the privacy policy',
  await until(
    `${has('By continuing you agree to the')} && !!document.querySelector('.mantine-Card-root a[href="/terms/"]') && !!document.querySelector('.mantine-Card-root a[href="/privacy/"]')`,
  ),
);
await js(
  `__t.type('input[autocomplete=nickname]', 'Dara'); __t.type('input[type=email]', ${JSON.stringify(email)}); __t.type('input[type=password]', 'a long enough password')`,
);
await js(`document.querySelector('form button[type=submit]').click()`);
ok(
  'creating an account through the form lands on the account page',
  await until(
    `location.pathname === '/account' && ${has('Signed in as')}`,
    8000,
  ),
  await js('location.pathname'),
);

// 2. The picture: a random portrait to begin with, in the bar and on the page; pick another.
const portraitIn = (selector: string) =>
  `(document.querySelector(${JSON.stringify(selector)} + ' img')?.getAttribute('src') ?? '').replace(/^.*\\/portraits\\/|\\.webp$/g, '')`;
ok(
  'a new account starts on a portrait, shown in the bar and on the page',
  await until(
    `${portraitIn('.account-link')} !== '' && ${portraitIn('.account-link')} === ${portraitIn('.picture-panel .player-avatar')}`,
  ),
  await js(`[${portraitIn('.account-link')}, ${portraitIn('.picture-panel')}]`),
);
const before = await js(portraitIn('.picture-panel .player-avatar'));
const choice = await js(
  `document.querySelector('.portrait-choice[aria-pressed="false"]').dataset.portrait`,
);
await js(
  `document.querySelector('.portrait-choice[data-portrait="${choice}"]').click()`,
);
ok(
  'picking a portrait changes the picture on the page and in the bar',
  await until(
    `${portraitIn('.picture-panel .player-avatar')} === ${JSON.stringify(choice)} && ${portraitIn('.account-link')} === ${JSON.stringify(choice)} && document.querySelector('.portrait-choice[data-portrait="${choice}"]').getAttribute('aria-pressed') === 'true'`,
  ),
  [before, choice, await js(portraitIn('.picture-panel .player-avatar'))],
);
const picked = await js(
  `fetch('http://localhost:3000/api/profile', { credentials: 'include' }).then(r => r.json())`,
);
ok(
  'the picked portrait is saved, with no photo to offer an email account',
  picked.avatar?.kind === 'portrait' &&
    picked.avatar?.portrait === choice &&
    picked.hasProviderPhoto === false,
  picked.avatar,
);
ok(
  'every portrait in the picker loads',
  await js(
    `Promise.all([...document.querySelectorAll('.portrait-choice img')].map(i => { i.loading = 'eager'; return i.decode().then(() => i.naturalWidth > 0, () => false); })).then(r => r.length === 42 && r.every(Boolean))`,
  ),
);
await fullShot('account-picture');
await phone();
await go('/account');
await until(`!!document.querySelector('.picture-panel')`);
await js(
  `Promise.all([...document.querySelectorAll('.portrait-choice img')].map(i => { i.loading = 'eager'; return i.decode().catch(() => null); }))`,
);
await fullShot('account-picture-phone');
await desktop();
await go('/account');

// 3. Pick a display name, and turn the public profile off.
await until(`!!document.querySelector('input[autocomplete=nickname]')`);
await js(
  `__t.type('input[autocomplete=nickname]', ${JSON.stringify(darName)})`,
);
await js(`__t.click('Save')`);
ok(
  'the new display name saves and heads the page',
  await until(`${has('Signed in as ' + darName)} && ${has('Saved.')}`),
  await js(`document.querySelector('.page-sub')?.textContent`),
);
ok(
  'the account page hides "Show when online" until friends can see who plays',
  (await js(
    `!${has('Show when online')} && document.querySelectorAll('.toggles input[type=checkbox]').length === 3`,
  )) === true,
  await js(
    `[...document.querySelectorAll('.toggles label')].map(l => l.textContent)`,
  ),
);
await js(`document.querySelector('.toggles input[type=checkbox]').click()`);
await until(`!document.querySelector('.toggles input[type=checkbox]').checked`);
const prof = await js(
  `fetch('http://localhost:3000/api/profile', { credentials: 'include' }).then(r => r.json())`,
);
ok(
  'turning the public profile off saves',
  prof.publicProfile === false && prof.displayName === darName,
  prof,
);
await shot('account');

// 3b. The cloud save: none at first; the game keeps one (through the API, as the game would), the page shows it, and
// deleting it from the page removes it.
ok(
  'the account page says the game keeps a cloud save once signed in there',
  await until(
    `!!document.querySelector('.cloud-save-panel') && ${has('No cloud save yet.')} && ${has('CLOUD SAVE')}`,
  ),
  await js(`document.querySelector('.cloud-save-panel')?.innerText`),
);
const game = await api('POST', '/api/auth/sign-in/email', {
  email,
  password: 'a long enough password',
});
const bytes = new Uint8Array(12_345).map((_, i) => (i * 31) % 256);
const written = await api(
  'PUT',
  '/api/saves/me',
  {
    data: Buffer.from(bytes).toString('base64'),
    description: 'Dara, level 41 (2 characters)',
    playSeconds: 148_020,
    gameVersion: '0.13.1',
  },
  game.token!,
);
ok(
  'the game keeps a cloud save for the account',
  written.status === 200 && written.body.size === 12_345,
  written.body,
);
await go('/account');
ok(
  'the account page shows the cloud save: description, play time, size, version, when',
  await until(
    `(() => { const t = document.querySelector('.cloud-save-panel')?.innerText ?? ''; return ['Dara, level 41 (2 characters)', '41:07', '12.3 KB', '0.13.1', 'Updated just now', 'Delete cloud save'].every((s) => t.includes(s)); })()`,
  ),
  await js(`document.querySelector('.cloud-save-panel')?.innerText`),
);
await elementShot('cloud-save', '.cloud-save-panel');
await phone();
await go('/account');
await until(`${has('41:07')}`);
await elementShot('cloud-save-phone', '.cloud-save-panel');
await desktop();
await go('/account');
await until(`${has('Delete cloud save')}`);
await js(`__t.click('Delete cloud save')`);
ok(
  'deleting the cloud save asks first',
  await until(`${has('Delete the cloud copy?')} && ${has('Keep it')}`),
);
await js(`__t.click('Yes, delete it')`);
ok(
  'and then the page shows none',
  await until(`${has('No cloud save yet.')} && !${has('41:07')}`),
  await js(`document.querySelector('.cloud-save-panel')?.innerText`),
);
const after = await api('GET', '/api/saves/me', undefined, game.token!);
ok(
  'the copy is gone from the server',
  after.status === 200 && after.body.exists === false,
  after.body,
);

// 3c. Friend suggestions (decision 229): Hal and Ira sign up now (through the API), so they are the newest players this
// week and head the list Dara has (no friends, records or chat of her own). Hide Ira; add Hal from the list.
const newcomer = async (name: string) => {
  const made = await api('POST', '/api/auth/sign-up/email', {
    name,
    email: `${name.toLowerCase()}-${run}@example.test`,
    password: 'a long enough password',
  });
  const displayName = `${name}${run}`;
  await api('PATCH', '/api/profile', { displayName }, made.token!);
  return { id: made.body.user?.id as string, displayName };
};
const hal = await newcomer('Hal');
const ira = await newcomer('Ira');
const suggestionRow = (name: string) =>
  `[...document.querySelectorAll('.suggestion-list .person-row')].find((r) => r.textContent.includes(${JSON.stringify(name)}))`;
const suggestionButton = (name: string, label: string) =>
  `[...(${suggestionRow(name)}?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`;
await go('/friends');
ok(
  'the friends page suggests the newest players, each with its line, picture and Add and Hide',
  await until(
    `(() => { const g = ${suggestionRow(ira.displayName)}; const f = ${suggestionRow(hal.displayName)}; return !!g && !!f && g.textContent.includes('Played this week') && !!g.querySelector('.player-avatar img') && !!${suggestionButton(ira.displayName, 'Add')} && !!${suggestionButton(ira.displayName, 'Hide')}; })()`,
  ),
  await js(`document.querySelector('.suggested')?.innerText`),
);
ok(
  "a suggested player's name opens their player page",
  await until(
    `!!document.querySelector('.suggestion-list a.person[href="/players/${ira.id}"]')`,
  ),
);
await elementShot('friends-suggested', '.suggested');
await js(`${suggestionButton(ira.displayName, 'Hide')}.click()`);
ok(
  'Hide leaves the player out for 30 days, and the list without them',
  await until(
    `${has(`${ira.displayName} won't be suggested for 30 days.`)} && !${suggestionRow(ira.displayName)} && !!${suggestionRow(hal.displayName)}`,
  ),
  await js(`document.querySelector('.suggested')?.innerText`),
);
await js(`${suggestionButton(hal.displayName, 'Add')}.click()`);
ok(
  'Add sends the request: Hal waits under "You asked" and leaves the suggestions',
  await until(
    `${has(`Request sent to ${hal.displayName}.`)} && !${suggestionRow(hal.displayName)} && [...document.querySelectorAll('.person-row')].some((r) => r.textContent.includes(${JSON.stringify(hal.displayName)}) && r.textContent.includes('Cancel'))`,
  ),
  await js(`document.querySelector('.suggested')?.innerText`),
);
await phone();
await go('/friends');
await until(`!!document.querySelector('.suggestion-list')`);
await elementShot('friends-suggested-phone', '.suggested');
await desktop();

// 4. Ask Eli to be friends; Eli accepts (through the API, as the game would).
await go('/friends');
await js(`__t.type('.panel input', ${JSON.stringify(eliName.toLowerCase())})`);
await js(`__t.click('Send request')`);
ok(
  'a friend request goes out by name, any case',
  await until(has(`Request sent to ${eliName}.`)),
  await js('__t.text().slice(0, 400)'),
);
ok('it waits under "You asked"', await until(has(eliName)));
await shot('friends-asked');
const incoming = await api(
  'GET',
  '/api/friends/requests/incoming',
  undefined,
  eli.token!,
);
await api(
  'POST',
  `/api/friends/requests/${incoming.body.data?.[0]?.id}/accept`,
  {},
  eli.token!,
);
await go('/friends');
ok(
  "after Eli accepts, Eli is on Dara's friends list, with Eli's picture",
  await until(
    `[...document.querySelectorAll('.friend-list .person-row')].some(li => li.textContent.includes(${JSON.stringify(eliName)}) && li.textContent.includes('since') && /\\/img\\/portraits\\/[a-z_]+\\.webp$/.test(li.querySelector('.player-avatar img')?.getAttribute('src') ?? ''))`,
  ),
);
ok(
  "a friend's name opens their player page",
  await until(
    `!!document.querySelector('.friend-list a.person[href="/players/${eliId}"]')`,
  ),
);
await shot('friends');

// 5. A board with the filters.
await go('/boards/pit_floor');
await js(
  `(() => { const s = document.querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'void'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`,
);
// Decision 230: the boards filter by the main talent path (the old class was every hero's barbarian).
ok(
  'the path filter goes into the address',
  await until(`location.search.includes('path=void')`),
);
await js(`__t.click('Friends', '.filters label')`);
ok(
  'the friends view goes into the address and the board answers',
  await until(
    `location.search.includes('view=friends') && !${has("Can't reach")}`,
  ),
);
await js(`__t.click('Hardcore', '.filters label')`);
ok(
  'the hardcore twin opens',
  await until(`${has('Hardcore deepest Bone Pit floor')}`),
);

// 5b. Decision 224: Eli's hardcore hero, wearing an avatar border. Its row on the hardcore board shows the HARDCORE
// badge beside the class and the border's frame round Eli's picture; its build page shows them and the rest. Decision
// 227: Ember is an online hero, on the board from Eli's realm (a save the game's Core wrote: floor 60, so the pit_50
// border), read by the rules checker.
const realmText = (
  await Bun.file(`${import.meta.dir}/.tmp/realm-eli.txt`).text()
).replace(/^name Ember$/m, `name Ember${run}`);
await api('POST', '/api/realm/lease', { deviceId: 'phone' }, eli.token!);
const realmUp = await api(
  'PUT',
  '/api/realm',
  {
    deviceId: 'phone',
    baseRevision: 0,
    data: Buffer.from(realmText).toString('base64'),
    reason: 'create',
  },
  eli.token!,
);
let emberEntry: any;
for (let i = 0; i < 80 && !emberEntry; i++) {
  const hc = await api('GET', '/api/leaderboards/hc_pit_floor?take=100');
  emberEntry = hc.body.entries?.data.find(
    (e: any) => e.hero.name === `Ember${run}`,
  );
  if (!emberEntry) await Bun.sleep(250);
}
const posted = { body: { entry: { buildId: emberEntry?.build.id } } };
ok(
  "Ember's realm goes up and its hardcore record, read from it, is on the board",
  realmUp.status === 200 &&
    emberEntry?.score === 60 &&
    emberEntry.build.extras.border === 'pit_50',
  [realmUp.status, realmUp.body, emberEntry?.score],
);
// An offline hero of Eli's, with its build (decision 226), for the player page.
const lantern = await api(
  'POST',
  '/api/heroes',
  { name: `Lantern${run}`, class: 'barbarian' },
  eli.token!,
);
await api(
  'POST',
  `/api/heroes/${lantern.body.hero?.id}/builds`,
  {
    build: {
      revision: 0,
      gameVersion: '0.13.1',
      level: 23,
      skills: [{ id: 'cleave', level: 12, slot: 0, supports: [] }],
      gear: [],
      talents: {},
      extras: { border: 'pit_30' },
      summary: { dps: 2_400, clearDps: 1_900, ehp: 6_100, life: 1_400 },
    },
  },
  eli.token!,
);
const emberRow = `[...document.querySelectorAll('.board-table tbody tr')].find(tr => tr.textContent.includes(${JSON.stringify(`Ember${run}`)}))`;
const frameLoads = (scope: string) =>
  `(() => { const img = ${scope}?.querySelector('.avatar-frame[data-border="pit_50"] img.avatar-frame-img'); if (!img) return false; img.loading = 'eager'; return img.decode().then(() => img.naturalWidth === 256, () => false); })()`;
await go('/boards/pit_floor?hardcore=true');
ok(
  "the hardcore hero's row shows the HARDCORE badge beside its class",
  await until(
    `!!(${emberRow})?.querySelector('.hero-badges .class-badge + .hardcore-badge')`,
  ),
  await js(`(${emberRow})?.innerText`),
);
ok(
  "the row frames Eli's picture with the hero's border, and the frame loads",
  (await js(frameLoads(`(${emberRow})`))) === true,
);
await fullShot('board-hardcore');
await phone();
await go('/boards/pit_floor?hardcore=true');
await until(`!!(${emberRow})`);
await js(frameLoads(`(${emberRow})`));
await fullShot('board-hardcore-phone');
await desktop();
await go(`/builds/${posted.body.entry?.buildId}`);
ok(
  'its build page shows the badge, the framed picture and the character',
  await until(
    `!!document.querySelector('.page-sub .hardcore-badge') && !!document.querySelector('.build-player .avatar-frame[data-border="pit_50"]') && ${has('Avatar border')}`,
  ),
);
await js(frameLoads('document'));
await fullShot('build');

// 5c. Decision 226: Eli's player page, from the board row's name: the picture in the best hero's border, every hero as a
// card (class, HARDCORE, ONLINE, level, DPS and EHP, records), each opening its build.
await go('/boards/pit_floor?hardcore=true');
await until(`!!(${emberRow})`);
ok(
  "the row's player name opens the player page",
  (await js(
    `(${emberRow})?.querySelector('a.player-link')?.getAttribute('href')`,
  )) === `/players/${eliId}`,
);
await js(`(${emberRow}).querySelector('a.player-link').click()`);
const playerReady = `location.pathname === '/players/${eliId}' && document.querySelectorAll('.player-hero').length === 2`;
ok(
  "Eli's page shows both heroes, Ember first (the higher level), online and hardcore, with its record",
  await until(
    `${playerReady} && (() => { const c = document.querySelector('.player-hero'); const t = c.innerText; return t.includes(${JSON.stringify(`Ember${run}`)}) && !!c.querySelector('.hardcore-badge') && !!c.querySelector('.online-badge') && t.includes('Hardcore deepest Bone Pit floor') && /#[0-9]+/.test(t) && t.includes('60'); })()`,
  ),
  await js('__t.text().slice(0, 600)'),
);
ok(
  'the offline hero shows without ONLINE, and every card opens its build',
  (await js(
    `(() => { const c = [...document.querySelectorAll('.player-hero')][1]; return c.innerText.includes(${JSON.stringify(`Lantern${run}`)}) && !c.querySelector('.online-badge') && [...document.querySelectorAll('.player-hero a.hero-link')].every(a => (a.getAttribute('href') ?? '').startsWith('/builds/')); })()`,
  )) === true,
);
ok(
  "the picture wears the best hero's border, and the frame loads",
  (await js(frameLoads(`document.querySelector('.player-head')`))) === true,
);
await fullShot('player');
await phone();
await go(`/players/${eliId}`);
await until(playerReady);
await js(frameLoads(`document.querySelector('.player-head')`));
ok(
  'the player page fits a phone',
  (await js(
    `document.documentElement.scrollWidth <= window.innerWidth + 1`,
  )) === true,
);
await fullShot('player-phone');
await desktop();

// 5d. Decision 228: chat moderation. Eli and Fen chat (through the API, as the game would) and Fen reports Eli's line.
// The page is no page to Dara until the script in the app's container gives her the admin role; then she moderates.
const fen = await api('POST', '/api/auth/sign-up/email', {
  name: 'Fen',
  email: `fen-${run}@example.test`,
  password: 'a long enough password',
});
const fenName = `Fen${run}`;
await api('PATCH', '/api/profile', { displayName: fenName }, fen.token!);
for (const token of [eli.token!, fen.token!])
  await api('POST', '/api/chat/rules/accept', {}, token);
await api(
  'POST',
  '/api/chat/global',
  { body: 'anyone for the Bone Pit?' },
  fen.token!,
);
const rude = await api(
  'POST',
  '/api/chat/global',
  { body: 'buy gold cheap, you shit' },
  eli.token!,
);
await api('POST', '/api/chat/global', { body: 'not you again' }, fen.token!);
ok(
  "Eli's line is stored as the filter left it",
  rude.body.body === 'buy gold cheap, you ****',
  rude.body,
);
const reported = await api(
  'POST',
  `/api/chat/messages/${rude.body.id}/report`,
  { reason: 'spam', note: 'gold seller' },
  fen.token!,
);
ok('Fen reports it', reported.status === 200, reported.body);
await go('/admin/chat');
ok(
  'the admin page is no page to a player without the role',
  await until(has('Nothing at this address')),
);
const granted =
  await Bun.$`docker exec gravoth-api bun run admin:grant ${darName}`
    .quiet()
    .nothrow();
ok(
  "the script in the app's container gives Dara the admin role",
  granted.exitCode === 0 &&
    granted.stdout.toString().includes('is now an admin'),
  granted.stderr.toString().slice(-300),
);
await go('/account');
ok(
  'the account page links an admin to the moderation page',
  await until(
    `!!document.querySelector('.moderation-panel a[href="/admin/chat"]')`,
  ),
);
await js(
  `document.querySelector('.moderation-panel a[href="/admin/chat"]').click()`,
);
ok(
  "the open reports show Eli's line with the reason, note and reporter, names to their pages",
  await until(
    `location.pathname === '/admin/chat' && ${has('buy gold cheap, you ****')} && ${has('gold seller')} && ${has(fenName)} && !!document.querySelector('.report-card a[href="/players/${eliId}"]')`,
    8000,
  ),
  await js('__t.text().slice(0, 400)'),
);
const contextShown = `document.querySelectorAll('.report-context .chat-line').length >= 3 && !!document.querySelector('.report-context .chat-line-focus')`;
await js(`__t.click('Messages around it')`);
ok(
  'the messages around it show, the reported one marked',
  await until(contextShown),
);
await fullShot('admin-chat');
await phone();
await go('/admin/chat');
await until(has('gold seller'));
await js(`__t.click('Messages around it')`);
await until(contextShown);
ok(
  'the admin page fits a phone',
  (await js(
    `document.documentElement.scrollWidth <= window.innerWidth + 1`,
  )) === true,
);
await fullShot('admin-chat-phone');
await desktop();
await go('/admin/chat');
await until(has('gold seller'));
await js(`__t.click('Hide and mute')`);
await until(`!!document.querySelector('.mute-choices')`);
await js(`__t.click('1 day')`);
ok('hide and mute closes the report', await until(has('No open reports')));
const silenced = await api(
  'POST',
  '/api/chat/global',
  { body: 'let me talk' },
  eli.token!,
);
ok(
  'Eli is muted',
  silenced.status === 403 && silenced.body.error === 'CHAT_MUTED',
  silenced.body,
);
await js(`__t.click('Closed')`);
ok(
  'the closed report says what was done, and by whom',
  await until(has(`Hidden and muted by ${darName}`)),
);
await fullShot('admin-closed');
await js(`__t.click('Mutes')`);
ok(
  'the mutes list Eli, for a day',
  await until(`${has(eliName)} && ${has('Muted until')}`),
);
await fullShot('admin-mutes');
await js(`__t.click('Unmute')`);
ok('unmuting empties the list', await until(has('Nobody is muted')));
await js(`__t.click('Global')`);
const line = (text: string) =>
  `[...document.querySelectorAll('.chat-line')].find((l) => l.textContent.includes(${JSON.stringify(text)}))`;
ok(
  'the global channel lists the messages, the hidden one marked',
  await until(
    `!!${line('not you again')} && ${line('buy gold cheap')}?.textContent.includes('Hidden')`,
  ),
);
await js(`${line('not you again')}.querySelector('button').click()`);
ok(
  'Hide marks a message hidden',
  await until(
    `${line('not you again')}?.textContent.includes('Hidden') && !${line('not you again')}.querySelector('button')`,
  ),
);
await fullShot('admin-global');
const channel = await api('GET', '/api/chat/global', undefined, eli.token!);
ok(
  "a hidden line leaves the players' channel",
  channel.status === 200 &&
    !channel.body.messages.some((m: any) => m.body === 'not you again') &&
    channel.body.removed.length >= 2,
  channel.body,
);

// 6. Remove Eli, sign out, sign back in.
await go('/friends');
await js(`__t.click('Remove')`);
ok('removing a friend empties the list', await until(has('No friends yet.')));
// No longer friends, Eli's page hidden: no such player to Dara.
await api('PATCH', '/api/profile', { publicProfile: false }, eli.token!);
await go(`/players/${eliId}`);
ok(
  "a hidden player's page, to someone who is not their friend, says there is no such player",
  await until(has('No such player')),
  await js('__t.text().slice(0, 300)'),
);
await go('/account');
await js(`__t.click('Sign out')`);
ok(
  'signing out goes home, with Sign in in the bar',
  await until(
    `location.pathname === '/' && [...document.querySelectorAll('.nav-link')].some(a => a.textContent === 'Sign in')`,
  ),
);
await go('/admin/chat');
ok(
  'signed out, the admin page asks to sign in',
  await until(has('to see this page')),
);
await go('/account');
ok(
  'the account page sends a signed-out visitor to sign in',
  await until(`location.pathname === '/sign-in'`),
);
await until(`!!document.querySelector('button.way-in')`);
await js(`__t.click('Continue with email')`);
await until(`!!document.querySelector('input[type=email]')`);
await js(
  `__t.type('input[type=email]', ${JSON.stringify(email)}); __t.type('input[type=password]', 'not the password')`,
);
await js(`document.querySelector('form button[type=submit]').click()`);
ok('a wrong password says so', await until(has('Wrong email or password.')));
await js(`__t.type('input[type=password]', 'a long enough password')`);
await js(`document.querySelector('form button[type=submit]').click()`);
ok(
  'signing back in returns to the account',
  await until(`location.pathname === '/account' && ${has(darName)}`, 8000),
);

// 7. Delete the account from the page.
await js(`__t.click('Delete my account')`);
await until(`!!document.querySelector('.panel-danger input[type=password]')`);
await js(
  `__t.type('.panel-danger input[type=password]', 'a long enough password'); __t.type('.panel-danger input:not([type=password])', 'DELETE')`,
);
await shot('delete');
await js(`__t.click('Delete everything')`);
ok(
  'deleting goes home, signed out',
  await until(
    `location.pathname === '/' && [...document.querySelectorAll('.nav-link')].some(a => a.textContent === 'Sign in')`,
    8000,
  ),
);
const again = await api('POST', '/api/auth/sign-in/email', {
  email,
  password: 'a long enough password',
});
ok('the deleted account cannot sign in', again.status === 401, again.status);

ok(
  'no console errors or exceptions on any page',
  problems.length === 0,
  problems,
);
ws.close();
chrome.kill();
console.log(failed === 0 ? '\nall passed' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
