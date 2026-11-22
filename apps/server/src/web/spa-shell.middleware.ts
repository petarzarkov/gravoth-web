import type { BunRequest } from 'bun';
import {
  STRICT_CSP,
  StaticOptions,
  UNMATCHED,
  type Middleware,
  type Next,
  type RouteContext,
} from '@dunx/http';

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

  async handle(req: BunRequest, ctx: RouteContext, next: Next): Promise<Response> {
    if (ctx.get(UNMATCHED) !== true || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
    const { pathname } = new URL(req.url);
    if (!SpaShell.owns(pathname) || !(req.headers.get('accept') ?? '').includes('text/html')) return next();

    const index = Bun.file(`${this.options.root}/index.html`);
    if (!(await index.exists())) return next();

    return new Response(req.method === 'HEAD' ? null : index, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // The page names the hashed bundles, so a cached copy would outlive a deploy.
        'cache-control': 'no-cache',
        'content-security-policy': STRICT_CSP,
      },
    });
  }

  /** A website path: not the API's, and not a file's (no dot in the last segment). */
  static owns(pathname: string): boolean {
    if (pathname === '/api' || pathname.startsWith('/api/')) return false;
    const last = pathname.slice(pathname.lastIndexOf('/') + 1);
    return !last.includes('.');
  }
}

/** Bun's bundler names every asset by an 8-character content hash (`apps/web/build.ts`). */
export const isHashedAsset = (pathname: string): boolean => /^\/assets\/[^/]+-[a-z0-9]{8}\.[a-z0-9]+(\.map)?$/.test(pathname);
