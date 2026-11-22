import type {
  ChatMessageView,
  ChatModeratedMessage,
  ChatPlayer,
} from '@gravoth/contracts';
import { and, eq, isNull, notExists, sql, type SQL } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { block, chatMessage, type ChatMessage } from '../database/schema.js';
import { NO_CARD, playerCards } from '../social/players.js';

/** Who wrote each message (or is the other player of one): the name and the picture, in one query. */
export const chatPlayers = async (
  db: Db,
  userIds: readonly (string | null)[],
): Promise<Map<string, ChatPlayer>> => {
  const ids = userIds.filter((id): id is string => id !== null);
  const cards = await playerCards(db, ids);
  return new Map(
    ids.map((userId) => [
      userId,
      { userId, ...(cards.get(userId) ?? NO_CARD) },
    ]),
  );
};

export const playerOf = (
  players: ReadonlyMap<string, ChatPlayer>,
  userId: string,
): ChatPlayer => players.get(userId) ?? { userId, ...NO_CARD };

/** A message as a player reads it. */
export const messageView = (
  row: ChatMessage,
  me: string,
  players: ReadonlyMap<string, ChatPlayer>,
): ChatMessageView => ({
  id: row.id,
  channel: row.channel,
  from: playerOf(players, row.senderId),
  body: row.body,
  at: row.createdAt.toISOString(),
  mine: row.senderId === me,
});

/** A message as moderation reads it: hidden or not, with the other player of a direct one. */
export const moderatedView = (
  row: ChatMessage,
  players: ReadonlyMap<string, ChatPlayer>,
): ChatModeratedMessage => ({
  id: row.id,
  channel: row.channel,
  from: playerOf(players, row.senderId),
  to: row.recipientId === null ? null : playerOf(players, row.recipientId),
  body: row.body,
  at: row.createdAt.toISOString(),
  hidden: row.hiddenAt !== null,
});

/** The direct messages between two players, whichever of them wrote (the pair index's own expressions). */
export const pairOf = (a: string, b: string): SQL =>
  sql`${chatMessage.channel} = 'direct' AND least(${chatMessage.senderId}, ${chatMessage.recipientId}) = least(${a}::uuid, ${b}::uuid) AND greatest(${chatMessage.senderId}, ${chatMessage.recipientId}) = greatest(${a}::uuid, ${b}::uuid)`;

/** Not from a player the reader blocked (decision 228: a blocked player's messages are not shown to the blocker). */
export const notBlockedBy = (me: string): SQL =>
  notExists(
    sql`(SELECT 1 FROM ${block} WHERE ${block.blockerId} = ${me}::uuid AND ${block.blockedId} = ${chatMessage.senderId})`,
  );

/** What a player may read: not removed by moderation, and not from a player they blocked. */
export const shownTo = (me: string): SQL =>
  and(isNull(chatMessage.hiddenAt), notBlockedBy(me)) ?? sql`true`;

/** The global channel. */
export const globalChannel: SQL = eq(chatMessage.channel, 'global');
