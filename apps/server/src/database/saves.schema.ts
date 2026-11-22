import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { CLOUD_SAVE_MAX_BYTES } from '@gravoth/contracts';
import { user } from './auth.schema.js';
import { bytea } from './columns.js';

/**
 * The game's cloud save (decision 225): one copy per account, replaced whole by the game (`PUT /api/saves/me`), gone
 * with its user. A guest has none: it has no way back in, so its save stays on the phone. The decoded bytes are kept,
 * not the base64; `size` and `sha256` are theirs, so the website and a check need not read the data.
 */
export const cloudSave = pgTable(
  'cloud_saves',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    data: bytea('data').notNull(),
    /** What the game's choice card shows ("Grom, level 24 (3 characters)"). */
    description: text('description').notNull().default(''),
    playSeconds: bigint('play_seconds', { mode: 'number' })
      .notNull()
      .default(0),
    gameVersion: text('game_version'),
    /** Bytes of `data`. */
    size: integer('size').notNull(),
    /** SHA-256 of `data`, hex. */
    sha256: text('sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      'cloud_saves_size',
      sql`${t.size} = octet_length(${t.data}) AND ${t.size} BETWEEN 1 AND ${sql.raw(String(CLOUD_SAVE_MAX_BYTES))}`,
    ),
    check('cloud_saves_sha256', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('cloud_saves_play_seconds', sql`${t.playSeconds} >= 0`),
    check(
      'cloud_saves_game_version',
      sql`${t.gameVersion} ~ '^[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,4}$'`,
    ),
  ],
);

export type CloudSave = typeof cloudSave.$inferSelect;
