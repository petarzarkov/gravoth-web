/**
 * `bun run build`: the website into `dist/`.
 *
 * - Every script, style and asset is named by its content hash, so it can be
 *   cached forever; `index.html` is the one file always fetched fresh.
 * - `public/` (the screenshots, the privacy policy at /privacy/, the terms of
 *   service at /terms/) is copied as is.
 * - With `GRAVOTH_API_BASE` set (the Cloudflare Pages build, CI's `site` job:
 *   https://gravoth-api.petarzarkov.com), the site calls the API there and gets
 *   a `_headers` file for Pages: the content security policy (scripts and styles
 *   from the site only, calls to the site and the API only, images from the site
 *   and the players' Google and Discord photos), the other security
 *   headers and the asset cache. Without it the site calls its own origin: the
 *   API serves that build itself (`WEB_ROOT`).
 */
import { AVATAR_IMAGE_SOURCES } from '@gravoth/contracts/constants';
import { cp, rm } from 'node:fs/promises';

const outdir = Bun.env['GRAVOTH_WEB_OUT'] ?? `${import.meta.dir}/dist`;
const apiBase = (Bun.env['GRAVOTH_API_BASE'] ?? '').replace(/\/+$/, '');
if (apiBase !== '' && URL.parse(apiBase)?.origin !== apiBase) {
  console.error(
    `GRAVOTH_API_BASE must be an origin (https://host), not ${apiBase}`,
  );
  process.exit(1);
}
await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [`${import.meta.dir}/src/index.html`],
  outdir,
  minify: true,
  sourcemap: 'linked',
  target: 'browser',
  // Absolute asset URLs: the page is served at nested paths (/boards/pit_floor).
  publicPath: '/',
  naming: {
    entry: '[dir]/[name].[ext]',
    chunk: 'assets/[name]-[hash].[ext]',
    asset: 'assets/[name]-[hash].[ext]',
  },
  define: {
    'process.env.NODE_ENV': '"production"',
    __GRAVOTH_API_BASE__: JSON.stringify(apiBase),
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await cp(`${import.meta.dir}/public`, outdir, { recursive: true });

if (apiBase !== '') {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    // Mantine writes its theme as a <style> element and sets element styles.
    "style-src 'self' 'unsafe-inline'",
    // A player's linked Google or Discord photo.
    `img-src 'self' data: ${AVATAR_IMAGE_SOURCES.join(' ')}`,
    `connect-src 'self' ${apiBase}`,
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
  // The privacy policy and the terms are self-contained pages with their own inline styles.
  const folderPage =
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'";
  await Bun.write(
    `${outdir}/_headers`,
    `/*
  Content-Security-Policy: ${policy}
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/privacy/*
  ! Content-Security-Policy
  Content-Security-Policy: ${folderPage}

/terms/*
  ! Content-Security-Policy
  Content-Security-Policy: ${folderPage}
`,
  );
}

for (const output of result.outputs) {
  const kb = (output.size / 1024).toFixed(1);
  console.log(`${output.path.slice(outdir.length + 1).padEnd(48)} ${kb} KB`);
}
console.log(
  apiBase === ''
    ? 'api: same origin'
    : `api: ${apiBase} (with _headers for Cloudflare Pages)`,
);
