import { BunSQLDatabase } from 'drizzle-orm/bun-sql';
import type * as schema from './schema.js';

/**
 * The drizzle handle every repository injects (`constructor(private readonly db: Db)`): drizzle's own `BunSQLDatabase`
 * over the one Postgres pool, named once with the schema's type. A class, so it is a token `@dunx/transform` can record.
 */
export class Db extends BunSQLDatabase<typeof schema> {}
