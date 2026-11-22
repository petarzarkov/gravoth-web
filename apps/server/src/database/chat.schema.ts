import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  CHAT_CHANNELS,
  CHAT_LIMITS,
  REPORT_ACTIONS,
  REPORT_REASONS,
} from '@gravoth/contracts';
import { user } from './auth.schema.js';

/** A list of plain ids as SQL (`'spam', 'hate'`): the lists are lowercase letters only. */
const listOf = (values: readonly string[]) =>
  sql.raw(
    values.map((value) => `'${value.replace(/[^a-z]/g, '')}'`).join(', '),
  );

const moment = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Decision 228: chat messages, both channels in one table, so one id orders everything a player sees. `global` has no
 * recipient; `direct` is between two players (the sender wrote to a friend; the pair is unordered for reading). The
 * body is stored as the word filter left it (masked words as `*`). `hidden_at` and `hidden_by` (`reports`: the
 * reports' own threshold; `moderator`: the admin page) take a message out of every player's view; it is kept until
 * the retention job (30 days, longer under an open report). Gone with either player.
 */
export const chatMessage = pgTable(
  'chat_messages',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    channel: text('channel', { enum: CHAT_CHANNELS }).notNull(),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id').references(() => user.id, {
      onDelete: 'cascade',
    }),
    body: text('body').notNull(),
    createdAt: moment('created_at').notNull().defaultNow(),
    hiddenAt: moment('hidden_at'),
    hiddenBy: text('hidden_by', { enum: ['reports', 'moderator'] }),
  },
  (t) => [
    check(
      'chat_messages_channel',
      sql`${t.channel} IN (${listOf(CHAT_CHANNELS)})`,
    ),
    check(
      'chat_messages_recipient',
      sql`(${t.channel} = 'global') = (${t.recipientId} IS NULL)`,
    ),
    check('chat_messages_not_self', sql`${t.recipientId} <> ${t.senderId}`),
    check(
      'chat_messages_body',
      sql`char_length(${t.body}) BETWEEN 1 AND ${sql.raw(String(CHAT_LIMITS.MAX_BODY))}`,
    ),
    check(
      'chat_messages_hidden',
      sql`(${t.hiddenAt} IS NULL) = (${t.hiddenBy} IS NULL) AND (${t.hiddenBy} IS NULL OR ${t.hiddenBy} IN ('reports', 'moderator'))`,
    ),
    // The global channel's poll and scroll-back.
    index('chat_messages_global_idx')
      .on(t.id)
      .where(sql`${t.channel} = 'global'`),
    // A pair's conversation, whichever of the two wrote.
    index('chat_messages_pair_idx')
      .on(
        sql`least(${t.senderId}, ${t.recipientId})`,
        sql`greatest(${t.senderId}, ${t.recipientId})`,
        t.id,
      )
      .where(sql`${t.channel} = 'direct'`),
    // Unread counts (and the recipient's foreign key).
    index('chat_messages_recipient_idx')
      .on(t.recipientId, t.senderId, t.id)
      .where(sql`${t.channel} = 'direct'`),
    // The flood and repeat checks, a player's messages for the admin page, and the sender's foreign key.
    index('chat_messages_sender_idx').on(t.senderId, t.createdAt),
    // The retention job.
    index('chat_messages_created_idx').on(t.createdAt),
    // `removed`: what moderation took out lately.
    index('chat_messages_hidden_idx')
      .on(t.hiddenAt)
      .where(sql`${t.hiddenAt} IS NOT NULL`),
  ],
);

/** How far a player has read a conversation: every direct message from `peer` up to `last_read_id` is read. */
export const chatRead = pgTable(
  'chat_reads',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    peerId: uuid('peer_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    lastReadId: bigint('last_read_id', { mode: 'number' }).notNull(),
    updatedAt: moment('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'chat_reads_pkey', columns: [t.userId, t.peerId] }),
    check('chat_reads_not_self', sql`${t.userId} <> ${t.peerId}`),
    check('chat_reads_last_read', sql`${t.lastReadId} >= 0`),
    index('chat_reads_peer_idx').on(t.peerId),
  ],
);

/**
 * A player's report of a message, one per message and reporter. It keeps a copy of the message (channel, sender,
 * recipient, body, time) so the developer can read it after the message itself is gone; `message_id` is that copy's id,
 * with no foreign key, since the message may go first. Open until resolved (`dismiss`, `hide` or `mute`); a closed
 * report goes 180 days after. Gone with the reporter, the sender or the recipient.
 */
export const chatReport = pgTable(
  'chat_reports',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    messageId: bigint('message_id', { mode: 'number' }).notNull(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    reason: text('reason', { enum: REPORT_REASONS }).notNull(),
    note: text('note').notNull().default(''),
    channel: text('channel', { enum: CHAT_CHANNELS }).notNull(),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id').references(() => user.id, {
      onDelete: 'cascade',
    }),
    body: text('body').notNull(),
    sentAt: moment('sent_at').notNull(),
    createdAt: moment('created_at').notNull().defaultNow(),
    resolution: text('resolution', { enum: REPORT_ACTIONS }),
    resolvedAt: moment('resolved_at'),
    resolvedBy: uuid('resolved_by').references(() => user.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    uniqueIndex('chat_reports_message_reporter_key').on(
      t.messageId,
      t.reporterId,
    ),
    check(
      'chat_reports_reason',
      sql`${t.reason} IN (${listOf(REPORT_REASONS)})`,
    ),
    check('chat_reports_note', sql`char_length(${t.note}) <= 200`),
    check(
      'chat_reports_channel',
      sql`${t.channel} IN (${listOf(CHAT_CHANNELS)})`,
    ),
    check(
      'chat_reports_recipient',
      sql`(${t.channel} = 'global') = (${t.recipientId} IS NULL)`,
    ),
    check(
      'chat_reports_resolution',
      sql`(${t.resolution} IS NULL) = (${t.resolvedAt} IS NULL) AND (${t.resolution} IS NULL OR ${t.resolution} IN (${listOf(REPORT_ACTIONS)}))`,
    ),
    // The open reports (the admin page, the threshold, and the retention job's hold on their messages).
    index('chat_reports_open_idx')
      .on(t.messageId)
      .where(sql`${t.resolvedAt} IS NULL`),
    // The closed reports, newest first, and their retention.
    index('chat_reports_resolved_idx')
      .on(t.resolvedAt)
      .where(sql`${t.resolvedAt} IS NOT NULL`),
    index('chat_reports_reporter_idx').on(t.reporterId),
    index('chat_reports_sender_idx').on(t.senderId),
    index('chat_reports_recipient_idx').on(t.recipientId),
  ],
);

/** A player muted in every channel until `until` (the admin page: an hour, a day, a week, or ten years for good). */
export const chatMute = pgTable(
  'chat_mutes',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    until: moment('until').notNull(),
    reason: text('reason').notNull().default(''),
    mutedBy: uuid('muted_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: moment('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('chat_mutes_reason', sql`char_length(${t.reason}) <= 200`),
    check('chat_mutes_until', sql`${t.until} > ${t.createdAt}`),
    index('chat_mutes_until_idx').on(t.until),
  ],
);

export type ChatMessage = typeof chatMessage.$inferSelect;
export type ChatReport = typeof chatReport.$inferSelect;
export type ChatMuteRow = typeof chatMute.$inferSelect;
