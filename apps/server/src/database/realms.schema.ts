import { sql } from 'drizzle-orm';
import {
  check,
  index,
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
 * The online realm (decision 227): one save per account holding all of its online heroes (the game's own save, the
 * phone's format), replaced whole at each accepted upload, gone with its user. `revision` counts the uploads, and an
 * upload names the one it builds on; `checked_revision` is the one the rules checker last read (its verdicts are on
 * the heroes and the boards). The lease is one device's (`lease_device` until `lease_until`): an upload or a lease
 * call renews it, another device's live lease refuses a lease call (unless forced), and an upload from a device that
 * is not `lease_device` is refused. The row is made by the first lease, before any data (`data` null, size 0).
 */
export const realm = pgTable(
  'realms',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    data: bytea('data'),
    revision: integer('revision').notNull().default(0),
    /** Bytes of `data` (0 without). */
    size: integer('size').notNull().default(0),
    /** SHA-256 of `data`, hex. */
    sha256: text('sha256'),
    /** The game's version that sent the last upload (its `x-gravoth-client` header), for the checker's build snapshots. */
    gameVersion: text('game_version'),
    checkedRevision: integer('checked_revision').notNull().default(0),
    leaseDevice: text('lease_device'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      'realms_size',
      sql`${t.size} = coalesce(octet_length(${t.data}), 0) AND ${t.size} BETWEEN 0 AND ${sql.raw(String(CLOUD_SAVE_MAX_BYTES))}`,
    ),
    check(
      'realms_sha256',
      sql`(${t.data} IS NULL AND ${t.sha256} IS NULL) OR (${t.data} IS NOT NULL AND ${t.sha256} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      'realms_revisions',
      sql`${t.revision} >= 0 AND ${t.checkedRevision} BETWEEN 0 AND ${t.revision}`,
    ),
    check(
      'realms_game_version',
      sql`${t.gameVersion} ~ '^[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,4}$'`,
    ),
    check(
      'realms_lease_device',
      sql`char_length(${t.leaseDevice}) BETWEEN 1 AND 128`,
    ),
  ],
);

/**
 * Decision 227: every offline hero moved online, once. The fingerprint is the rules checker's
 * (`SaveHeroes.Fingerprint` in the game's repository: the hero's class, body, hair and the first five entries of its
 * level clock, or its name while the clock is shorter), so the same hero from a restored backup of the phone's save
 * cannot be moved twice, to this account or another. Gone with the user (whose realm, and so the moved hero, goes too).
 */
export const realmTransfer = pgTable(
  'realm_transfers',
  {
    fingerprint: text('fingerprint').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The hero's id in the realm when it was moved. */
    characterId: integer('character_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      'realm_transfers_fingerprint',
      sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check('realm_transfers_character', sql`${t.characterId} >= 0`),
    index('realm_transfers_user_idx').on(t.userId),
  ],
);

export type Realm = typeof realm.$inferSelect;
export type RealmTransfer = typeof realmTransfer.$inferSelect;
