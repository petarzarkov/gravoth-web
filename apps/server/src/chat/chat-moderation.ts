import { AuthContext } from '@dunx/auth';
import { HttpError, HttpStatusCode } from '@dunx/http';
import type {
  AdminChatQuery,
  ChatModeratedMessage,
  ChatMuteView,
  ChatReportView,
  MutePlayer,
  ReportsQuery,
  ResolveReport,
} from '@gravoth/contracts';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { Db } from '../database/db.js';
import {
  chatMessage,
  chatMute,
  chatReport,
  user,
  type ChatMessage,
  type ChatReport,
} from '../database/schema.js';
import {
  chatPlayers,
  globalChannel,
  moderatedView,
  pairOf,
  playerOf,
} from './chat-views.js';

const m = chatMessage;
const r = chatReport;
/** The most mutes listed at once. */
const MUTES_MAX = 200;

/** A moderator's hide: kept hidden, whoever hid it first. */
const hideMessage = {
  hiddenAt: sql`coalesce(${m.hiddenAt}, now())`,
  hiddenBy: 'moderator' as const,
};

/**
 * The admin page's moderation (decision 228; `/api/admin/chat`, the `admin` role only): the reports, their outcome, the
 * mutes, and any message hidden or not. A report's outcome closes every open report of the same message: `dismiss`
 * shows again a message the reports' own threshold hid, `hide` removes it, `mute` removes it and mutes its writer.
 */
export class ChatModeration {
  constructor(
    private readonly db: Db,
    private readonly context: AuthContext,
  ) {}

  /** Open or closed reports, newest first. */
  async reports(query: ReportsQuery): Promise<readonly ChatReportView[]> {
    const rows = await this.db
      .select()
      .from(r)
      .where(
        and(
          query.state === 'open'
            ? isNull(r.resolvedAt)
            : isNotNull(r.resolvedAt),
          query.before === undefined ? undefined : lt(r.id, query.before),
        ),
      )
      .orderBy(desc(r.id))
      .limit(query.take);
    return this.reportViews(rows);
  }

  async resolve(id: number, outcome: ResolveReport): Promise<ChatReportView> {
    const moderator = this.context.require().user.id;
    const resolved = await this.db.transaction(async (tx) => {
      const [report] = await tx.select().from(r).where(eq(r.id, id)).limit(1);
      if (report === undefined)
        throw new HttpError(HttpStatusCode.NOT_FOUND, 'REPORT_NOT_FOUND');
      if (outcome.action === 'dismiss')
        await tx
          .update(m)
          .set({ hiddenAt: null, hiddenBy: null })
          .where(and(eq(m.id, report.messageId), eq(m.hiddenBy, 'reports')));
      else
        await tx.update(m).set(hideMessage).where(eq(m.id, report.messageId));
      if (outcome.action === 'mute')
        await this.muteIn(tx, {
          userId: report.senderId,
          hours: outcome.hours ?? 1,
          reason: outcome.reason ?? `reported: ${report.reason}`,
          moderator,
        });
      const now = new Date();
      await tx
        .update(r)
        .set({
          resolution: outcome.action,
          resolvedAt: now,
          resolvedBy: moderator,
        })
        .where(
          or(
            eq(r.id, report.id),
            and(eq(r.messageId, report.messageId), isNull(r.resolvedAt)),
          ),
        );
      const [after] = await tx.select().from(r).where(eq(r.id, id)).limit(1);
      return after ?? report;
    });
    const [view] = await this.reportViews([resolved]);
    if (view === undefined) throw new Error('report view missing');
    return view;
  }

  /** The mutes in force, newest first. */
  async mutes(): Promise<readonly ChatMuteView[]> {
    const rows = await this.db
      .select()
      .from(chatMute)
      .where(gt(chatMute.until, new Date()))
      .orderBy(desc(chatMute.createdAt))
      .limit(MUTES_MAX);
    const players = await chatPlayers(
      this.db,
      rows.map((row) => row.userId),
    );
    return rows.map((row) => ({
      player: playerOf(players, row.userId),
      until: row.until.toISOString(),
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** Mutes a player from now for `hours` (a mute already in force is replaced). 404 `PLAYER_NOT_FOUND`. */
  async mute(body: MutePlayer): Promise<ChatMuteView> {
    const moderator = this.context.require().user.id;
    const [found] = await this.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, body.userId))
      .limit(1);
    if (found === undefined)
      throw new HttpError(HttpStatusCode.NOT_FOUND, 'PLAYER_NOT_FOUND');
    await this.muteIn(this.db, { ...body, moderator });
    const mute = (await this.mutes()).find(
      (row) => row.player.userId === body.userId,
    );
    if (mute === undefined) throw new Error('mute not stored');
    return mute;
  }

  /** 404 `MUTE_NOT_FOUND` when the player has none. */
  async unmute(userId: string): Promise<void> {
    const gone = await this.db
      .delete(chatMute)
      .where(eq(chatMute.userId, userId))
      .returning({ userId: chatMute.userId });
    if (gone.length === 0)
      throw new HttpError(HttpStatusCode.NOT_FOUND, 'MUTE_NOT_FOUND');
  }

  /** The global channel's messages, a player's, or a pair's conversation, hidden ones too; oldest first. */
  async messages(
    query: AdminChatQuery,
  ): Promise<readonly ChatModeratedMessage[]> {
    const scope: SQL | undefined =
      query.userId === undefined
        ? globalChannel
        : query.peerId === undefined
          ? eq(m.senderId, query.userId)
          : pairOf(query.userId, query.peerId);
    let rows: ChatMessage[];
    if (query.around !== undefined) {
      const before = Math.ceil(query.take / 2);
      const older = await this.db
        .select()
        .from(m)
        .where(and(scope, lte(m.id, query.around)))
        .orderBy(desc(m.id))
        .limit(before);
      const newer = await this.db
        .select()
        .from(m)
        .where(and(scope, gt(m.id, query.around)))
        .orderBy(asc(m.id))
        .limit(query.take - before);
      rows = [...older.reverse(), ...newer];
    } else {
      rows = (
        await this.db
          .select()
          .from(m)
          .where(
            and(
              scope,
              query.before === undefined ? undefined : lt(m.id, query.before),
            ),
          )
          .orderBy(desc(m.id))
          .limit(query.take)
      ).reverse();
    }
    const players = await chatPlayers(
      this.db,
      rows.flatMap((row) => [row.senderId, row.recipientId]),
    );
    return rows.map((row) => moderatedView(row, players));
  }

  /** 404 `MESSAGE_NOT_FOUND`. */
  async hide(id: number): Promise<ChatModeratedMessage> {
    const [row] = await this.db
      .update(m)
      .set(hideMessage)
      .where(eq(m.id, id))
      .returning();
    if (row === undefined)
      throw new HttpError(HttpStatusCode.NOT_FOUND, 'MESSAGE_NOT_FOUND');
    const players = await chatPlayers(this.db, [row.senderId, row.recipientId]);
    return moderatedView(row, players);
  }

  private async muteIn(
    db: Pick<Db, 'insert'>,
    mute: { userId: string; hours: number; reason: string; moderator: string },
  ): Promise<void> {
    const now = new Date();
    const until = new Date(now.getTime() + mute.hours * 3_600_000);
    await db
      .insert(chatMute)
      .values({
        userId: mute.userId,
        until,
        reason: mute.reason,
        mutedBy: mute.moderator,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: chatMute.userId,
        set: {
          until,
          reason: mute.reason,
          mutedBy: mute.moderator,
          createdAt: now,
        },
      });
  }

  private async reportViews(
    rows: readonly ChatReport[],
  ): Promise<readonly ChatReportView[]> {
    if (rows.length === 0) return [];
    const messageIds = [...new Set(rows.map((row) => row.messageId))];
    const [live, counts] = await Promise.all([
      this.db
        .select({ id: m.id, hiddenAt: m.hiddenAt })
        .from(m)
        .where(inArray(m.id, messageIds)),
      this.db
        .select({
          messageId: r.messageId,
          reporters: sql<number>`count(*)::int`,
        })
        .from(r)
        .where(inArray(r.messageId, messageIds))
        .groupBy(r.messageId),
    ]);
    const hidden = new Map(live.map((row) => [row.id, row.hiddenAt !== null]));
    const reporters = new Map(
      counts.map((row) => [row.messageId, Number(row.reporters)]),
    );
    const players = await chatPlayers(
      this.db,
      rows.flatMap((row) => [
        row.reporterId,
        row.senderId,
        row.recipientId,
        row.resolvedBy,
      ]),
    );
    return rows.map((row) => ({
      id: row.id,
      reason: row.reason,
      note: row.note,
      reporter: playerOf(players, row.reporterId),
      message: {
        id: row.messageId,
        channel: row.channel,
        from: playerOf(players, row.senderId),
        to:
          row.recipientId === null ? null : playerOf(players, row.recipientId),
        body: row.body,
        at: row.sentAt.toISOString(),
        hidden: hidden.get(row.messageId) ?? false,
      },
      reports: reporters.get(row.messageId) ?? 1,
      createdAt: row.createdAt.toISOString(),
      resolved:
        row.resolution === null || row.resolvedAt === null
          ? null
          : {
              action: row.resolution,
              at: row.resolvedAt.toISOString(),
              by:
                row.resolvedBy === null
                  ? ''
                  : playerOf(players, row.resolvedBy).displayName,
            },
    }));
  }
}
