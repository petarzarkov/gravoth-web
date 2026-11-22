import type { Page } from '@dunx/infra/pagination';

/** The query every growing list takes (keyset, `@dunx/infra/pagination`): the contracts' own. */
export { PageQuery } from '@gravoth/contracts';

/** A page with its rows mapped, the cursors kept. */
export const mapPage = async <A, B>(
  page: Page<A>,
  map: (rows: readonly A[]) => Promise<readonly B[]> | readonly B[],
): Promise<Page<B>> => ({
  data: await map(page.data),
  meta: page.meta,
});
