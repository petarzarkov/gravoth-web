import { PAGINATION, type Page } from '@dunx/infra/pagination';
import { z } from 'zod';

/**
 * The query every growing list takes (`@dunx/infra/pagination`, keyset): `take` rows, and the `cursor` from a page's
 * `meta.nextCursor` (or `meta.previousCursor` with `direction=backward`) to move on. No offsets, so a row written
 * while someone pages never shows twice or goes missing.
 */
export const PageQuery = z.object({
  take: z.coerce.number().int().min(PAGINATION.MIN_TAKE).max(PAGINATION.MAX_TAKE).default(PAGINATION.DEFAULT_TAKE),
  direction: z.enum(['forward', 'backward']).default(PAGINATION.DEFAULT_DIRECTION),
  cursor: z.string().max(PAGINATION.MAX_CURSOR).optional(),
});

export type PageQuery = z.infer<typeof PageQuery>;

/** A page with its rows mapped, the cursors kept. */
export const mapPage = async <A, B>(page: Page<A>, map: (rows: readonly A[]) => Promise<readonly B[]> | readonly B[]): Promise<Page<B>> => ({
  data: await map(page.data),
  meta: page.meta,
});
