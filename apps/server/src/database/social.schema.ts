import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth.schema.js';

/**
 * The player as other players see them: one profile per user, made when the user is (auth.module.ts), gone with it.
 *
 * The display name is what boards, friends and chat show, and what a friend request is sent to. Unique without regard
 * to case (`Sol` and `sol` are one name), 3 to 20 letters, digits, `_` or `-`, starting with a letter or digit; the
 * word filter (profiles/display-names.ts) is checked before a name is stored.
 */
export const profile = pgTable(
  'profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    /** False while the name is the one made at sign-up; a guest's chosen name moves to the account it becomes. */
    nameChosen: boolean('name_chosen').notNull().default(false),
    /** The hero pages and the player's name on the boards; false shows "A hidden player" in its place. */
    publicProfile: boolean('public_profile').notNull().default(true),
    /** False refuses every friend request. */
    allowFriendRequests: boolean('allow_friend_requests')
      .notNull()
      .default(true),
    /** Whether friends see this player online (chat, step 6). */
    showOnline: boolean('show_online').notNull().default(true),
    /** A mail for each friend request, to a confirmed address only. */
    emailFriendRequests: boolean('email_friend_requests')
      .notNull()
      .default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('profiles_display_name_key').on(sql`lower(${t.displayName})`),
    check(
      'profiles_display_name_format',
      sql`${t.displayName} ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$'`,
    ),
  ],
);

/**
 * Friend requests and friendships: one row per pair of players, whichever of them asked. `pending` until the addressee
 * accepts (then `accepted`, with `responded_at`); declining or cancelling deletes the row, so a later request is a new
 * one.
 *
 * The pair is unordered: the unique index on (least, greatest) refuses B asking A while A's request to B stands, and
 * a check refuses asking oneself.
 */
export const friendship = pgTable(
  'friendships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    addresseeId: uuid('addressee_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'accepted'] })
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('friendships_pair_key').on(
      sql`least(${t.requesterId}, ${t.addresseeId})`,
      sql`greatest(${t.requesterId}, ${t.addresseeId})`,
    ),
    check('friendships_not_self', sql`${t.requesterId} <> ${t.addresseeId}`),
    check('friendships_status', sql`${t.status} IN ('pending', 'accepted')`),
    check(
      'friendships_responded',
      sql`(${t.status} = 'pending') = (${t.respondedAt} IS NULL)`,
    ),
    index('friendships_requester_idx').on(t.requesterId, t.status, t.createdAt),
    index('friendships_addressee_idx').on(t.addresseeId, t.status, t.createdAt),
  ],
);

/**
 * Blocks, one way: the blocker no longer sees requests (or, from step 6, whispers and chat) from the blocked player.
 * Blocking ends any friendship or request between the two.
 */
export const block = pgTable(
  'blocks',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'blocks_pkey', columns: [t.blockerId, t.blockedId] }),
    check('blocks_not_self', sql`${t.blockerId} <> ${t.blockedId}`),
    index('blocks_blocked_idx').on(t.blockedId),
  ],
);

export type Profile = typeof profile.$inferSelect;
export type Friendship = typeof friendship.$inferSelect;
