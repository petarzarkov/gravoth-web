// `bun run e2e` (e2e/run.sh): the website driven like a person, in headless Chrome over the DevTools protocol, against
// the local stack. Screenshots of the account (its cloud save too), friends, board, build and delete pages land in
// e2e/.tmp/ui.
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
await shot('friends');

// 5. A board with the filters.
await go('/boards/pit_floor');
await js(
  `(() => { const s = document.querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'templar'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`,
);
ok(
  'the class filter goes into the address',
  await until(`location.search.includes('class=templar')`),
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
// badge beside the class and the border's frame round Eli's picture; its build page shows them and the rest.
const ember = await api(
  'POST',
  '/api/heroes',
  { name: `Ember${run}`, class: 'templar', hardcore: true },
  eli.token!,
);
const posted = await api(
  'POST',
  '/api/leaderboards/hc_pit_floor/scores',
  {
    heroId: ember.body.hero?.id,
    score: 4321,
    build: {
      revision: 1,
      gameVersion: '0.13.0',
      level: 88,
      skills: [
        {
          id: 'judgement',
          level: 20,
          slot: 0,
          supports: [{ id: 'melee_phys', level: 18 }],
        },
      ],
      gear: [
        {
          slot: 'MainHand',
          name: 'Oath Hammer',
          base: 'War Maul',
          rarity: 'Rare',
          itemLevel: 80,
          lines: [{ text: '+40 to Strength', kind: 'suffix', tier: 2 }],
        },
      ],
      talents: { version: 3, points: 80, earned: 84, nodes: [1, 2, 3] },
      extras: {
        border: 'pit_50',
        marks: 210,
        attributes: { strength: 250 },
        rites: [{ slot: 1, id: 'oathbound', name: 'Oathbound', nodes: ['a'] }],
      },
      summary: { dps: 98_000, clearDps: 70_000, ehp: 40_000, life: 4_800 },
    },
  },
  eli.token!,
);
ok(
  'a hardcore record with an avatar border posts',
  posted.status < 300 && typeof posted.body.entry?.buildId === 'string',
  [posted.status, posted.body],
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
    `!!document.querySelector('.page-sub .hardcore-badge') && !!document.querySelector('.build-player .avatar-frame[data-border="pit_50"]') && ${has('Avatar border')} && ${has('Oathbound')}`,
  ),
);
await js(frameLoads('document'));
await fullShot('build');

// 6. Remove Eli, sign out, sign back in.
await go('/friends');
await js(`__t.click('Remove')`);
ok('removing a friend empties the list', await until(has('No friends yet.')));
await go('/account');
await js(`__t.click('Sign out')`);
ok(
  'signing out goes home, with Sign in in the bar',
  await until(
    `location.pathname === '/' && [...document.querySelectorAll('.nav-link')].some(a => a.textContent === 'Sign in')`,
  ),
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
