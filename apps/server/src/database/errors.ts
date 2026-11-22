/**
 * Postgres's own error, under drizzle's `DrizzleQueryError` (its `cause`). `Bun.SQL` puts the SQLSTATE in `errno` and
 * the constraint's name in `constraint`, which is how a service turns a unique violation into a 409 without a read
 * before every write (the read would race anyway).
 */
interface PostgresFailure {
  readonly errno?: string;
  readonly constraint?: string;
}

const failureOf = (error: unknown): PostgresFailure | undefined => {
  for (
    let current = error, depth = 0;
    current !== null && typeof current === 'object' && depth < 4;
    depth++
  ) {
    const candidate = current as PostgresFailure & { cause?: unknown };
    if (typeof candidate.errno === 'string') return candidate;
    current = candidate.cause;
  }
  return undefined;
};

/** SQLSTATE 23505, optionally on one named constraint or index. */
export const isUniqueViolation = (
  error: unknown,
  constraint?: string,
): boolean => {
  const failure = failureOf(error);
  return (
    failure?.errno === '23505' &&
    (constraint === undefined || failure.constraint === constraint)
  );
};

/** SQLSTATE 23503: a foreign key refused the row. */
export const isForeignKeyViolation = (error: unknown): boolean =>
  failureOf(error)?.errno === '23503';

/** SQLSTATE 23514: a check constraint refused the row; its name, or undefined for any other error. */
export const checkViolation = (error: unknown): string | undefined => {
  const failure = failureOf(error);
  return failure?.errno === '23514' ? (failure.constraint ?? '') : undefined;
};

/** The SQLSTATE of a Postgres error anywhere in the chain. */
export const sqlState = (error: unknown): string | undefined =>
  failureOf(error)?.errno;
