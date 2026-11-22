import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestApp, type TestApp } from './testing/app.js';
import { SpaShell, isHashedAsset } from './web/spa-shell.middleware.js';

/**
 * The website served by the API (web/): its page for every path it owns, its
 * hashed assets cached forever, and the API's own answers untouched. Over a
 * stand-in build, so the suite needs no `bun run build`.
 */
let started: TestApp;
let base = '';
let root = '';

const html = { accept: 'text/html,application/xhtml+xml' };

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'gravoth-web-'));
  await mkdir(join(root, 'assets'));
  await Bun.write(
    join(root, 'index.html'),
    '<!doctype html><title>Gravoth Online</title><div id="root"></div>',
  );
  await Bun.write(
    join(root, 'assets', 'index-ab12cd34.js'),
    'console.log("site")',
  );
  await mkdir(join(root, 'privacy'));
  await Bun.write(
    join(root, 'privacy', 'index.html'),
    '<!doctype html><title>Privacy</title><style>p{}</style><p>policy</p>',
  );
  await Bun.write(
    join(root, 'favicon.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  started = await startTestApp({ config: { WEB_ROOT: root } });
  base = started.base;
});

afterAll(async () => {
  await started.close();
  await rm(root, { recursive: true, force: true });
});

describe('the website', () => {
  it('serves its page at / and at every path it owns, with a strict policy', async () => {
    for (const path of [
      '/',
      '/boards/pit_floor',
      '/builds/0b6a7c58-1d1e-4b5b-9d1c-1a2b3c4d5e6f',
      '/account',
    ]) {
      const response = await fetch(`${base}${path}`, { headers: html });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(response.headers.get('content-security-policy')).toContain(
        "script-src 'self'",
      );
      // Images from the site, and the players' linked Google and Discord photos only.
      expect(response.headers.get('content-security-policy')).toContain(
        "img-src 'self' data: https://*.googleusercontent.com https://cdn.discordapp.com;",
      );
      expect(await response.text()).toContain('<div id="root">');
    }
  });

  it('caches a hashed asset forever and 404s a missing one', async () => {
    const asset = await fetch(`${base}/assets/index-ab12cd34.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(await asset.text()).toBe('console.log("site")');

    const missing = await fetch(`${base}/assets/gone-ab12cd34.js`, {
      headers: html,
    });
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type') ?? '').not.toContain(
      'text/html',
    );
  });

  it('leaves the API alone: JSON answers, and a 404 under /api stays JSON', async () => {
    const meta = await fetch(`${base}/api/meta`, { headers: html });
    expect(meta.status).toBe(200);
    expect(meta.headers.get('content-type')).toContain('application/json');

    const nope = await fetch(`${base}/api/nope`, { headers: html });
    expect(nope.status).toBe(404);
    expect(nope.headers.get('content-type') ?? '').not.toContain('text/html');
  });

  it('answers a script asking for / with the API 404, not the page', async () => {
    const response = await fetch(`${base}/`, {
      headers: { accept: 'application/json' },
    });
    expect(response.status).toBe(404);
  });

  it('sends the security headers on API answers too', async () => {
    const response = await fetch(`${base}/api/meta`);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('strict-transport-security')).toContain(
      'max-age=',
    );
    // The policy is the page's own; the mail pages and Swagger UI carry inline styles.
    expect(response.headers.get('content-security-policy')).toBeNull();
  });
});

describe('a folder page', () => {
  it('serves /privacy and /privacy/ as the policy page, with its own policy, to any caller', async () => {
    for (const [path, headers] of [
      ['/privacy', html],
      ['/privacy/', html],
      ['/privacy/', {}],
    ] as const) {
      const response = await fetch(`${base}${path}`, { headers });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('<p>policy</p>');
      expect(response.headers.get('content-security-policy')).toContain(
        "style-src 'unsafe-inline'",
      );
    }
  });

  it('never reads outside the build', async () => {
    const response = await fetch(`${base}/..%2F..%2Fetc`, { headers: html });
    expect(await response.text()).not.toContain('root:');
  });
});

describe('which paths are the website', () => {
  it('owns page paths, never the API or a file', () => {
    expect(SpaShell.owns('/')).toBe(true);
    expect(SpaShell.owns('/boards/hc_marks')).toBe(true);
    expect(SpaShell.owns('/api')).toBe(false);
    expect(SpaShell.owns('/api/account/reset-password')).toBe(false);
    expect(SpaShell.owns('/favicon.svg')).toBe(false);
    expect(SpaShell.owns('/assets/index-ab12cd34.js')).toBe(false);
  });

  it('caches only content-hashed asset names forever', () => {
    expect(isHashedAsset('/assets/index-ab12cd34.js')).toBe(true);
    expect(isHashedAsset('/assets/index-ab12cd34.js.map')).toBe(true);
    expect(isHashedAsset('/index.html')).toBe(false);
    expect(isHashedAsset('/favicon.svg')).toBe(false);
  });
});
