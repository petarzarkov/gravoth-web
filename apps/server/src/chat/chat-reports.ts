import { AuthContext } from '@dunx/auth';
import { HttpError, HttpStatusCode } from '@dunx/http';
import { CHAT_LIMITS, type ReportMessage } from '@gravoth/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { block, chatMessage, chatReport } from '../database/schema.js';
import { requireAccount } from '../social/players.js';

/**
 * A player's report of a message (decision 228): any message they can see and did not write (404 `MESSAGE_NOT_FOUND`
 * for one they cannot, 400 `CANNOT_REPORT_SELF` for their own), with a reason and an optional note. Reporting a message
 * twice changes nothing. The report keeps a copy of the message for the developer, and `AUTO_HIDE_REPORTS` distinct
 * players reporting one global message while their reports are open hide it until the developer looks (a dismissal
 * shows it again).
 */
export class ChatReports {
  constructor(
    private readonly db: Db,
    private readonly context: AuthContext,
  ) {}

  async report(messageId: number, report: ReportMessage): Promise<void> {
    const me = requireAccount(this.context).id;
    const [message] = await this.db
      .select({
        row: chatMessage,
        blocked: sql<boolean>`EXISTS (SELECT 1 FROM ${block} WHERE ${block.blockerId} = ${me}::uuid AND ${block.blockedId} = ${chatMessage.senderId})`,
      })
      .from(chatMessage)
      .where(eq(chatMessage.id, messageId))
      .limit(1);
    const row = message?.row;
    const seen =
      row !== undefined &&
      row.hiddenAt === null &&
      message?.blocked !== true &&
      (row.channel === 'global' ||
        row.senderId === me ||
        row.recipientId === me);
    if (!seen)
      throw new HttpError(HttpStatusCode.NOT_FOUND, 'MESSAGE_NOT_FOUND');
    if (row.senderId === me)
      throw new HttpError(HttpStatusCode.BAD_REQUEST, 'CANNOT_REPORT_SELF');

    await this.db.transaction(async (tx) => {
      const stored = await tx
        .insert(chatReport)
        .values({
          messageId: row.id,
          reporterId: me,
          reason: report.reason,
          note: report.note ?? '',
          channel: row.channel,
          senderId: row.senderId,
          recipientId: row.recipientId,
          body: row.body,
          sentAt: row.createdAt,
        })
        .onConflictDoNothing({
          target: [chatReport.messageId, chatReport.reporterId],
        })
        .returning({ id: chatReport.id });
      if (stored.length === 0 || row.channel !== 'global') return;
      const [open] = await tx
        .select({ reporters: sql<number>`count(*)::int` })
        .from(chatReport)
        .where(
          and(eq(chatReport.messageId, row.id), isNull(chatReport.resolvedAt)),
        );
      if (Number(open?.reporters ?? 0) >= CHAT_LIMITS.AUTO_HIDE_REPORTS)
        await tx
          .update(chatMessage)
          .set({ hiddenAt: new Date(), hiddenBy: 'reports' })
          .where(and(eq(chatMessage.id, row.id), isNull(chatMessage.hiddenAt)));
    });
  }
}
