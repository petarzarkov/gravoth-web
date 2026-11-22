/**
 * `bun run build`: the website into `dist/`, which @gravoth/server serves
 * (`WEB_ROOT`). Every script, style and asset is named by its content hash, so
 * the server can cache them forever; `index.html` is the one file that is
 * always fetched fresh.
 */
import { rm } from 'node:fs/promises';

const outdir = `${import.meta.dir}/dist`;
await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [`${import.meta.dir}/src/index.html`],
  outdir,
  minify: true,
  sourcemap: 'linked',
  target: 'browser',
  naming: {
    entry: '[dir]/[name].[ext]',
    chunk: 'assets/[name]-[hash].[ext]',
    asset: 'assets/[name]-[hash].[ext]',
  },
  define: { 'process.env.NODE_ENV': '"production"' },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

for (const output of result.outputs) {
  const kb = (output.size / 1024).toFixed(1);
  console.log(`${output.path.slice(outdir.length + 1).padEnd(48)} ${kb} KB`);
}
