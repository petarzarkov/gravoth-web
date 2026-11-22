/**
 * Cloudflare Pages, closely enough for the end-to-end run: serves a Pages build (`GRAVOTH_API_BASE` set, so it calls
 * the API on another origin) the way Pages does: a file if there is one, a folder's own index.html (/privacy/), the
 * app's index.html for any other path (Pages' single-page fallback, no 404.html), and the `_headers` rules, a later
 * rule's `! Name` detaching an earlier one's header.
 *
 *   bun e2e/pages.ts <dist> [port=3001]
 */
import { normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'apps/web/dist');
const port = Number(process.argv[3] ?? 3001);

interface Rule {
  readonly pattern: RegExp;
  readonly set: [string, string][];
  readonly detach: string[];
}

const rules: Rule[] = [];
const headersFile = Bun.file(`${root}/_headers`);
if (await headersFile.exists()) {
  let current: Rule | undefined;
  for (const line of (await headersFile.text()).split('\n')) {
    if (line.trim() === '') continue;
    if (!line.startsWith(' ')) {
      const glob = line
        .trim()
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      current = { pattern: new RegExp(`^${glob}$`), set: [], detach: [] };
      rules.push(current);
    } else if (current !== undefined) {
      const text = line.trim();
      if (text.startsWith('!'))
        current.detach.push(text.slice(1).trim().toLowerCase());
      else {
        const colon = text.indexOf(':');
        current.set.push([
          text.slice(0, colon).trim().toLowerCase(),
          text.slice(colon + 1).trim(),
        ]);
      }
    }
  }
}

const withHeaders = (pathname: string, response: Response): Response => {
  for (const rule of rules) {
    if (!rule.pattern.test(pathname)) continue;
    for (const name of rule.detach) response.headers.delete(name);
    for (const [name, value] of rule.set) response.headers.set(name, value);
  }
  return response;
};

const inside = (path: string) =>
  path === root || path.startsWith(`${root}${sep}`) ? path : undefined;

Bun.serve({
  port,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const local = inside(
      resolve(root, `.${normalize(decodeURIComponent(pathname))}`),
    );
    if (local !== undefined) {
      const file = Bun.file(local);
      if (!pathname.endsWith('/') && (await file.exists()))
        return withHeaders(pathname, new Response(file));
      const index = Bun.file(`${local}/index.html`);
      if (await index.exists()) {
        if (!pathname.endsWith('/'))
          return Response.redirect(`${pathname}/`, 308);
        return withHeaders(
          pathname,
          new Response(index, {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
        );
      }
    }
    return withHeaders(
      pathname,
      new Response(Bun.file(`${root}/index.html`), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );
  },
});
console.log(`pages  http://localhost:${port}  (${root})`);
