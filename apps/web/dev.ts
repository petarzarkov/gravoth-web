/**
 * `bun run dev:web`: the website with hot reload on http://localhost:3001,
 * `/api` passed through to the API on `API_URL` (default
 * http://localhost:3000, `bun run dev`). The API needs
 * `CORS_ORIGIN=http://localhost:3001` so better-auth and the cross-site check
 * trust this origin. Production has no such server: `bun run build` writes
 * `dist/`, which the API serves itself.
 */
import index from './src/index.html';

const api = (Bun.env['API_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '');
const port = Number(Bun.env['WEB_PORT'] ?? 3001);

const proxy = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const headers = new Headers(req.headers);
  headers.delete('host');
  const response = await fetch(`${api}${url.pathname}${url.search}`, {
    method: req.method,
    headers,
    ...(req.method === 'GET' || req.method === 'HEAD'
      ? {}
      : { body: await req.arrayBuffer() }),
    redirect: 'manual',
  });
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
};

const server = Bun.serve({
  port,
  development: { hmr: true, console: true },
  routes: {
    '/api/*': proxy,
    '/*': index,
  },
});

console.log(`web  ${server.url.href}  (api ${api})`);
