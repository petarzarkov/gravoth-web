import { Logger } from '@dunx/core';
import { Cron } from '@dunx/infra/schedule';
import { SUGGESTION_LIMITS } from '@gravoth/contracts';
import { lte } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { suggestionDismissal } from '../database/schema.js';

/**
 * Decision 229's daily clean-up of friend-suggestion dismissals, at 04:50 (SCHEDULE_TZ, UTC by default), after the
 * 03:30 backup, the 04:15 guest clean-up and the 04:45 chat retention: a dismissal past `DISMISS_DAYS` hides nobody
 * any more, so its row goes. A player's dismissals, and those of them, go with their account at once, through the
 * foreign keys.
 */
export class SuggestionCleanup {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  @Cron('50 4 * * *', { name: 'suggestion-cleanup' })
  async daily(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      this.logger.error('suggestion clean-up failed', { err: error });
    }
  }

  /** Deletes the dismissals past keeping as of `now`, and answers how many. */
  async run(now = new Date()): Promise<number> {
    const before = new Date(
      now.getTime() - SUGGESTION_LIMITS.DISMISS_DAYS * 86_400_000,
    );
    const removed = await this.db
      .delete(suggestionDismissal)
      .where(lte(suggestionDismissal.dismissedAt, before))
      .returning({ userId: suggestionDismissal.userId });
    this.logger.info('suggestion clean-up', {
      removed: removed.length,
      keepDays: SUGGESTION_LIMITS.DISMISS_DAYS,
    });
    return removed.length;
  }
}
