import { Logger } from '@dunx/core';
import { Cron } from '@dunx/infra/schedule';
import { CHAT_LIMITS } from '@gravoth/contracts';
import { and, eq, isNull, lt, lte, notExists, sql } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { chatMessage, chatMute, chatReport } from '../database/schema.js';

/** Days a closed report (with its copy of the message) is kept after it was closed. */
export const CLOSED_REPORT_KEEP_DAYS = 180;

export interface ChatRetentionResult {
  readonly messages: number;
  readonly reports: number;
  readonly mutes: number;
}

/**
 * Decision 228's retention, daily at 04:45 (SCHEDULE_TZ, UTC by default), after the 03:30 backup and the 04:15 guest
 * clean-up: messages older than `KEEP_DAYS` go unless an open report holds them (until it is closed), closed reports
 * `CLOSED_REPORT_KEEP_DAYS` after they were closed, and mutes once they end. A player's chat goes with their account
 * at once, through the foreign keys.
 */
export class ChatRetention {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  @Cron('45 4 * * *', { name: 'chat-retention' })
  async daily(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      this.logger.error('chat retention failed', { err: error });
    }
  }

  /** Deletes what is past keeping as of `now`, and answers how many of each. */
  async run(now = new Date()): Promise<ChatRetentionResult> {
    const messagesBefore = new Date(
      now.getTime() - CHAT_LIMITS.KEEP_DAYS * 86_400_000,
    );
    const reportsBefore = new Date(
      now.getTime() - CLOSED_REPORT_KEEP_DAYS * 86_400_000,
    );
    const messages = await this.db
      .delete(chatMessage)
      .where(
        and(
          lt(chatMessage.createdAt, messagesBefore),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(chatReport)
              .where(
                and(
                  eq(chatReport.messageId, chatMessage.id),
                  isNull(chatReport.resolvedAt),
                ),
              ),
          ),
        ),
      )
      .returning({ id: chatMessage.id });
    const reports = await this.db
      .delete(chatReport)
      .where(lt(chatReport.resolvedAt, reportsBefore))
      .returning({ id: chatReport.id });
    const mutes = await this.db
      .delete(chatMute)
      .where(lte(chatMute.until, now))
      .returning({ userId: chatMute.userId });
    const result = {
      messages: messages.length,
      reports: reports.length,
      mutes: mutes.length,
    };
    this.logger.info('chat retention', {
      ...result,
      keepDays: CHAT_LIMITS.KEEP_DAYS,
    });
    return result;
  }
}
