import { normalize, resolve, sep } from 'node:path';
import type { BunRequest } from 'bun';
import {
  StaticOptions,
  UNMATCHED,
  type Middleware,
  type Next,
  type RouteContext,
} from '@dunx/http';
import { AVATAR_IMAGE_SOURCES } from '@gravoth/contracts';

/**
 * The website's page for every path the website owns (`/`, `/boards/pit_floor`,
 * `/builds/<id>`, `/account`): `index.html`, and the app's router takes it from
 * there. `StaticFiles` (after this in the chain) serves the assets.
 *
 * Narrow on purpose, like the template's `HomeMiddleware`: only a request no
 * route matched, only `GET`/`HEAD`, only a browser asking for HTML, never under
 * `/api`, and never a path that names a file. So `curl /api/nope` still gets
 * the JSON 404, and a missing `/assets/x.js` is a 404 rather than a page.
 *
 * The page carries a strict content security policy (same-origin scripts and
 * styles only), set here rather than app-wide because the API's own small mail
 * pages and the Swagger UI carry inline styles.
 */
export class SpaShell implements Middleware {
  constructor(private readonly options: StaticOptions) {}

  async handle(
    req: BunRequest,
    ctx: RouteContext,
    next: Next,
  ): Promise<Response> {
    if (
      ctx.get(UNMATCHED) !== true ||
      (req.method !== 'GET' && req.method !== 'HEAD')
    )
      return next();
    const { pathname } = new URL(req.url);
    if (!SpaShell.owns(pathname)) return next();

    // A folder with a page of its own (/privacy/, the policy Play links to) is that page, for any caller.
    const own = this.folderPage(pathname);
    if (own !== undefined && (await own.exists())) {
      return new Response(req.method === 'HEAD' ? null : own, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-cache',
          // A self-contained page with its own inline styles, and nothing else.
          'content-security-policy': FOLDER_PAGE_POLICY,
        },
      });
    }

    // The app's page, for a browser only: a script asking for a path no route has still gets the API's 404.
    if (!(req.headers.get('accept') ?? '').includes('text/html')) return next();
    const index = Bun.file(`${this.options.root}/index.html`);
    if (!(await index.exists())) return next();

    return new Response(req.method === 'HEAD' ? null : index, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // The page names the hashed bundles, so a cached copy would outlive a deploy.
        'cache-control': 'no-cache',
        'content-security-policy': SITE_POLICY,
      },
    });
  }

  /** `<root>/<path>/index.html` when the path is a folder under the root (never outside it), else undefined. */
  private folderPage(
    pathname: string,
  ): ReturnType<typeof Bun.file> | undefined {
    if (pathname === '/') return undefined;
    const root = resolve(this.options.root);
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return undefined;
    }
    const page = resolve(root, `.${normalize(decoded)}`, 'index.html');
    return page.startsWith(`${root}${sep}`) ? Bun.file(page) : undefined;
  }

  /** A website path: not the API's, and not a file's (no dot in the last segment). */
  static owns(pathname: string): boolean {
    if (pathname === '/api' || pathname.startsWith('/api/')) return false;
    const last = pathname.slice(pathname.lastIndexOf('/') + 1);
    return !last.includes('.');
  }
}

/**
 * The website's policy: scripts, connections and everything else from the site only. Styles may also be inline:
 * Mantine (the website's UI kit) writes its theme as a `<style>` element and sets element styles. Images may also be
 * a player's linked Google or Discord photo (`AVATAR_IMAGE_SOURCES`).
 */
export const SITE_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${AVATAR_IMAGE_SOURCES.join(' ')}`,
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

/** The policy a folder's own page gets: its inline styles and images from the site, nothing else. */
const FOLDER_PAGE_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'";

/** Bun's bundler names every asset by an 8-character content hash (`apps/web/build.ts`). */
export const isHashedAsset = (pathname: string): boolean =>
  /^\/assets\/[^/]+-[a-z0-9]{8}\.[a-z0-9]+(\.map)?$/.test(pathname);
