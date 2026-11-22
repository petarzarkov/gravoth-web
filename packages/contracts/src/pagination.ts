import { z } from 'zod';
import { PAGE_LIMITS } from './constants.js';

/**
 * The query every growing list takes: `take` rows, and the `cursor` from a
 * page's `meta.nextCursor` (or `meta.previousCursor` with
 * `direction=backward`) to move on. No offsets, so a row written while someone
 * pages never shows twice or goes missing.
 */
export const PageQuery = z.object({
  take: z.coerce
    .number()
    .int()
    .min(PAGE_LIMITS.MIN_TAKE)
    .max(PAGE_LIMITS.MAX_TAKE)
    .default(PAGE_LIMITS.DEFAULT_TAKE),
  direction: z.enum(['forward', 'backward']).default('forward'),
  cursor: z.string().max(PAGE_LIMITS.MAX_CURSOR).optional(),
});

export type PageQuery = z.infer<typeof PageQuery>;

export interface PageMeta {
  readonly take: number;
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
  /** Pass back as `?cursor=` to read forwards. Null at the end. */
  readonly nextCursor: string | null;
  /** Pass back with `?direction=backward`. Null at the start. */
  readonly previousCursor: string | null;
}

export interface Page<T> {
  readonly data: readonly T[];
  readonly meta: PageMeta;
}
