import { Module } from '@dunx/core';
import {
  DbConnection,
  DbModule,
  QueryMetrics,
  SqlOptions,
} from '@dunx/infra/db';
import { AppConfigService } from '../config.js';
import { Db } from './db.js';
import { Migrations } from './migrations.js';
import * as schema from './schema.js';

/**
 * Postgres through `Bun.SQL` (`@dunx/infra/db`'s `SqlOptions`): one pool, opened and handshaked before any repository
 * is built, closed last at shutdown. `DATABASE_URL`, or the POSTGRES_* parts config.ts builds it from. The migrations in
 * drizzle/ are applied before the first request (migrations.ts).
 */
@Module({
  imports: [
    // The token comes first, unlike `forRoot`: the handle's class is only known once the factory has produced the
    // options. `Db` is drizzle's own `BunSQLDatabase`, named once with the schema's type.
    DbModule.forRootAsync(
      Db,
      {
        useFactory: (config: AppConfigService) =>
          new SqlOptions({
            schema,
            url: config.get('database').url,
            max: config.get('database').poolMax,
            // Seconds: an unreachable database is a boot error, not a hang.
            connectionTimeout: 10,
            idleTimeout: 60,
          }),
        inject: [AppConfigService],
      },
      // Times every query, readable as `QueryMetrics`.
      { metrics: true },
    ),
  ],
  providers: [Migrations],
  /** Re-exported so importers can inject them: `DbModule` exports to this module only. */
  exports: [Db, DbConnection, QueryMetrics, Migrations],
})
export class DatabaseModule {}
