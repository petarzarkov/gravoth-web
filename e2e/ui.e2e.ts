// `bun run e2e` (e2e/run.sh): the website driven like a person, in headless Chrome over the DevTools protocol, against
// the local stack. Screenshots of the account, friends and delete pages land in e2e/.tmp/ui.
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
    click(text, scope = 'button, a') {
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
const has = (text: string) => `__t.text().includes(${JSON.stringify(text)})`;

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

// 1. Create an account through the form.
await go('/sign-in');
await js(`__t.click('Create account')`);
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

// 2. Pick a display name, and turn the public profile off.
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
await js(`document.querySelector('.toggle input').click()`);
await until(`!document.querySelector('.toggle input').checked`);
const prof = await js(
  `fetch('http://localhost:3000/api/profile', { credentials: 'include' }).then(r => r.json())`,
);
ok(
  'turning the public profile off saves',
  prof.publicProfile === false && prof.displayName === darName,
  prof,
);
await shot('account');

// 3. Ask Eli to be friends; Eli accepts (through the API, as the game would).
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
  "after Eli accepts, Eli is on Dara's friends list",
  await until(
    `[...document.querySelectorAll('.people li')].some(li => li.textContent.includes(${JSON.stringify(eliName)}) && li.textContent.includes('since'))`,
  ),
);
await shot('friends');

// 4. A board with the filters.
await go('/boards/pit_floor');
await js(
  `(() => { const s = document.querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'templar'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`,
);
ok(
  'the class filter goes into the address',
  await until(`location.search.includes('class=templar')`),
);
await js(`__t.click('Friends', '.filters button')`);
ok(
  'the friends view goes into the address and the board answers',
  await until(
    `location.search.includes('view=friends') && !${has("Can't reach")}`,
  ),
);
await js(`__t.click('Hardcore', '.filters button')`);
ok(
  'the hardcore twin opens',
  await until(`${has('Hardcore deepest Bone Pit floor')}`),
);

// 5. Remove Eli, sign out, sign back in.
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

// 6. Delete the account from the page.
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
