import { describe, expect, test } from 'bun:test';
import { PAGINATION } from '@dunx/infra/pagination';
import { ERROR_CODES, PAGE_LIMITS } from '@gravoth/contracts';
import { Glob } from 'bun';

/**
 * The contracts repeat a few of the server's facts so a browser bundle needs no
 * server package. These keep the copies honest.
 */
describe('contracts', () => {
  test("the page limits are dunx's own", () => {
    expect(PAGE_LIMITS.MIN_TAKE).toBe(PAGINATION.MIN_TAKE);
    expect(PAGE_LIMITS.MAX_TAKE).toBe(PAGINATION.MAX_TAKE);
    expect(PAGE_LIMITS.DEFAULT_TAKE).toBe(PAGINATION.DEFAULT_TAKE);
    expect(PAGE_LIMITS.MAX_CURSOR).toBe(PAGINATION.MAX_CURSOR);
  });

  test('every error code the server throws is in ERROR_CODES', async () => {
    const thrown = new Set<string>();
    const pattern = /HttpError\(\s*HttpStatusCode\.[A-Z_]+,\s*'([A-Z_]+)'/g;
    for await (const path of new Glob('**/*.ts').scan({
      cwd: import.meta.dir,
    })) {
      if (path.endsWith('.test.ts')) continue;
      const source = await Bun.file(`${import.meta.dir}/${path}`).text();
      for (const match of source.matchAll(pattern)) thrown.add(match[1] ?? '');
    }
    expect(thrown.size).toBeGreaterThan(10);
    const known = new Set<string>(ERROR_CODES);
    expect([...thrown].filter((code) => !known.has(code))).toEqual([]);
  });
});
