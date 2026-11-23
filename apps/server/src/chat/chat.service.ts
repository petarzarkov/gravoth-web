import { AuthContext } from '@dunx/auth';
import { HttpError, HttpStatusCode } from '@dunx/http';
import type {
  ChatMute,
  ChatPage,
  ChatQuery,
  ChatUnread,
  ConversationView,
} from '@gravoth/contracts';
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  notExists,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { Db } from '../database/db.js';
import {
  block,
  chatMessage,
  chatMute,
  chatRead,
  friendship,
  profile,
  user,
} from '../database/schema.js';
import { Presence } from '../presence/presence.js';
import { requireAccount } from '../social/players.js';
import {
  chatPlayers,
  globalChannel,
  messageView,
  notBlockedBy,
  pairOf,
  playerOf,
  shownTo,
} from './chat-views.js';

/** How far back a page's `removed` reaches. */
const REMOVED_HOURS = 24;
/** The most ids a page's `removed` carries, and the most conversations listed. */
const REMOVED_MAX = 200;
const CONVERSATIONS_MAX = 100;

const m = chatMessage;

/**
 * Reading chat (decision 228): a channel's pages (the global channel, or a conversation with one player), the
 * conversations, the unread counts and read marks, and accepting the rules. Every route needs an account, never a
 * guest. A conversation stays readable to both players once they are no longer friends; only sending needs a friend
 * (chat-sends.ts).
 */
export class Chat {
  constructor(
    private readonly db: Db,
    private readonly context: AuthContext,
    private readonly presence: Presence,
  ) {}

  /** The global channel, or the conversation with `peer`. */
  async page(peer: string | undefined, query: ChatQuery): Promise<ChatPage> {
    const me = requireAccount(this.context).id;
    if (peer !== undefined) await this.requirePlayer(me, peer);
    const channel = peer === undefined ? globalChannel : pairOf(me, peer);
    const rows = await this.db
      .select()
      .from(m)
      .where(
        and(
          channel,
          shownTo(me),
          query.after === undefined ? undefined : gt(m.id, query.after),
          query.before === undefined ? undefined : lt(m.id, query.before),
        ),
      )
      .orderBy(desc(m.id))
      .limit(query.take + 1);
    const page = rows.slice(0, query.take).reverse();
    const players = await chatPlayers(
      this.db,
      page.map((row) => row.senderId),
    );
    const [removed, state] = await Promise.all([
      this.removed(channel),
      this.state(me),
    ]);
    return {
      messages: page.map((row) => messageView(row, me, players)),
      gap: query.after !== undefined && rows.length > query.take,
      removed,
      ...state,
    };
  }

  /**
   * The players the caller has a conversation with (friends, or friends once), the newest conversation first; a friend
   * shows whether they are online (presence.ts), a friend no longer never does.
   */
  async conversations(): Promise<readonly ConversationView[]> {
    const me = requireAccount(this.context).id;
    const peer = sql<string>`CASE WHEN ${m.senderId} = ${me}::uuid THEN ${m.recipientId} ELSE ${m.senderId} END`;
    const rows = await this.db
      .select({
        peer,
        newest: sql<string>`max(${m.id})`,
        shown: sql<
          string | null
        >`max(${m.id}) FILTER (WHERE ${m.hiddenAt} IS NULL)`,
      })
      .from(m)
      .where(
        and(
          eq(m.channel, 'direct'),
          or(eq(m.senderId, me), eq(m.recipientId, me)),
          // A player the caller blocked drops out of the list, whichever of the two wrote.
          notBlockedBy(me),
          notExists(
            sql`(SELECT 1 FROM ${block} WHERE ${block.blockerId} = ${me}::uuid AND ${block.blockedId} = ${m.recipientId})`,
          ),
        ),
      )
      // By position: the peer's expression carries a parameter, which Postgres would not match to a second copy.
      .groupBy(sql`1`)
      .orderBy(desc(sql`max(${m.id})`))
      .limit(CONVERSATIONS_MAX);
    if (rows.length === 0) return [];
    const lastIds = rows.flatMap((row) =>
      row.shown === null ? [] : [Number(row.shown)],
    );
    const last =
      lastIds.length === 0
        ? []
        : await this.db.select().from(m).where(inArray(m.id, lastIds));
    const byId = new Map(last.map((row) => [row.id, row]));
    const peers = rows.map((row) => row.peer);
    const [players, unread, online] = await Promise.all([
      // The caller too: the last line may be theirs.
      chatPlayers(this.db, [...peers, me]),
      this.unreadBy(me),
      this.onlineFriends(me, peers),
    ]);
    return rows.map((row) => {
      const message =
        row.shown === null ? undefined : byId.get(Number(row.shown));
      return {
        peer: playerOf(players, row.peer),
        last: message === undefined ? null : messageView(message, me, players),
        unread: unread.get(row.peer) ?? 0,
        online: online.has(row.peer),
      };
    });
  }

  /** Which of `peers` are the caller's friends and online. */
  private async onlineFriends(
    me: string,
    peers: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (peers.length === 0) return new Set();
    const friends = await this.db
      .select({
        peer: sql<string>`CASE WHEN ${friendship.requesterId} = ${me}::uuid THEN ${friendship.addresseeId} ELSE ${friendship.requesterId} END`,
      })
      .from(friendship)
      .where(
        and(
          eq(friendship.status, 'accepted'),
          or(
            and(
              eq(friendship.requesterId, me),
              inArray(friendship.addresseeId, [...peers]),
            ),
            and(
              eq(friendship.addresseeId, me),
              inArray(friendship.requesterId, [...peers]),
            ),
          ),
        ),
      );
    return this.presence.online(friends.map((row) => row.peer));
  }

  /** The badge: unread direct messages, all together and per player. */
  async unread(): Promise<ChatUnread> {
    const me = requireAccount(this.context).id;
    const counts = await this.unreadBy(me);
    const from = [...counts]
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId));
    return {
      direct: from.reduce((sum, entry) => sum + entry.count, 0),
      from,
    };
  }

  /** Every message from `peer` up to `upTo` (at most the conversation's newest) is read; a mark never moves back. */
  async markRead(peer: string, upTo: number): Promise<void> {
    const me = requireAccount(this.context).id;
    await this.requirePlayer(me, peer);
    const [newest] = await this.db
      .select({ id: sql<string | null>`max(${m.id})` })
      .from(m)
      .where(pairOf(me, peer));
    const lastReadId = Math.min(upTo, Number(newest?.id ?? 0));
    await this.db
      .insert(chatRead)
      .values({ userId: me, peerId: peer, lastReadId })
      .onConflictDoUpdate({
        target: [chatRead.userId, chatRead.peerId],
        set: {
          lastReadId: sql`greatest(${chatRead.lastReadId}, excluded.last_read_id)`,
          updatedAt: new Date(),
        },
      });
  }

  /** The chat rules, accepted once (the first time is kept). */
  async acceptRules(): Promise<void> {
    const me = requireAccount(this.context).id;
    await this.db
      .update(profile)
      .set({ chatRulesAt: sql`coalesce(${profile.chatRulesAt}, now())` })
      .where(eq(profile.userId, me));
  }

  /** The caller's mute, and whether they accepted the rules: on every page, so the game knows what the input may do. */
  async state(
    me: string,
  ): Promise<{ muted: ChatMute | null; rulesAccepted: boolean }> {
    const [rules] = await this.db
      .select({ at: profile.chatRulesAt })
      .from(profile)
      .where(eq(profile.userId, me))
      .limit(1);
    return {
      muted: await activeMute(this.db, me),
      rulesAccepted: rules?.at !== null && rules?.at !== undefined,
    };
  }

  /** Ids moderation removed from this channel in the last day, newest first. */
  private async removed(channel: SQL): Promise<readonly number[]> {
    const rows = await this.db
      .select({ id: m.id })
      .from(m)
      .where(
        and(
          channel,
          gt(m.hiddenAt, new Date(Date.now() - REMOVED_HOURS * 3_600_000)),
        ),
      )
      .orderBy(desc(m.id))
      .limit(REMOVED_MAX);
    return rows.map((row) => row.id);
  }

  /** Unread direct messages to `me`, by sender: newer than the read mark, shown, not from a player `me` blocked. */
  private async unreadBy(me: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({
        userId: m.senderId,
        count: sql<number>`count(*)::int`,
      })
      .from(m)
      .leftJoin(
        chatRead,
        and(eq(chatRead.userId, me), eq(chatRead.peerId, m.senderId)),
      )
      .where(
        and(
          eq(m.channel, 'direct'),
          eq(m.recipientId, me),
          isNull(m.hiddenAt),
          gt(m.id, sql`coalesce(${chatRead.lastReadId}, 0)`),
          notBlockedBy(me),
        ),
      )
      .groupBy(m.senderId);
    return new Map(rows.map((row) => [row.userId, Number(row.count)]));
  }

  /** A conversation is with another player who exists. */
  private async requirePlayer(me: string, peer: string): Promise<void> {
    if (peer === me)
      throw new HttpError(HttpStatusCode.NOT_FOUND, 'PLAYER_NOT_FOUND');
    const [found] = await this.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, peer))
      .limit(1);
    if (found === undefined)
      throw new HttpError(HttpStatusCode.NOT_FOUND, 'PLAYER_NOT_FOUND');
  }
}

/** A player's mute while it lasts, or null. */
export const activeMute = async (
  db: Db,
  userId: string,
): Promise<ChatMute | null> => {
  const [row] = await db
    .select({ until: chatMute.until, reason: chatMute.reason })
    .from(chatMute)
    .where(and(eq(chatMute.userId, userId), gt(chatMute.until, new Date())))
    .limit(1);
  return row === undefined
    ? null
    : { until: row.until.toISOString(), reason: row.reason };
};
