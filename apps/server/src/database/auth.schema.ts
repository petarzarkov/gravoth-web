import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * better-auth's four tables (with the columns its `admin` and `anonymous` plugins add), in Postgres. better-auth's
 * drizzle adapter reads them through this schema object, under its singular model names (`user`, `session`, ...), so
 * the SQL names can be plural and snake_case like every other table.
 *
 * Ids are uuids made by Postgres (`advanced.database.generateId: 'uuid'` in auth.module.ts), so every foreign key to a
 * user is one 16-byte type. One `account` row per sign-in a user has linked: `credential` (email and password),
 * `google`, `discord`.
 */
const created = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const user = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Lowercase (better-auth folds it); a guest's is a placeholder under the reserved `.invalid` domain. */
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    /** `admin` plugin. Comma-separated for more than one; `rolesOf` splits it. */
    role: text('role'),
    banned: boolean('banned'),
    banReason: text('ban_reason'),
    banExpires: timestamp('ban_expires', { withTimezone: true }),
    /** `anonymous` plugin: a guest account. */
    isAnonymous: boolean('is_anonymous'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
  ],
);

export const session = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: text('token').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /** `admin` plugin. */
    impersonatedBy: uuid('impersonated_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('sessions_token_key').on(t.token),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

export const account = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The provider's id for the person (Google's `sub`, Discord's user id; the user id for `credential`). */
    accountId: text('account_id').notNull(),
    /** `credential` for email and password, else the provider: `google`, `discord`. */
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    // One person at a provider is one of our users, never two.
    uniqueIndex('accounts_provider_account_key').on(t.providerId, t.accountId),
    // One row per linked provider: a user has at most one password, one Google and one Discord.
    uniqueIndex('accounts_user_provider_key').on(t.userId, t.providerId),
    check(
      'accounts_password_only_credential',
      sql`${t.password} IS NULL OR ${t.providerId} = 'credential'`,
    ),
  ],
);

export const verification = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    index('verifications_identifier_idx').on(t.identifier),
    index('verifications_expires_idx').on(t.expiresAt),
  ],
);

export type AuthUser = typeof user.$inferSelect;
