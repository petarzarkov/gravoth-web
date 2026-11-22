import { Logger } from '@dunx/core';
import { Cron } from '@dunx/infra/schedule';
import { and, eq, gte, lt, notExists, sql } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { hero, session, user } from '../database/schema.js';

/** How long a guest with no records may go unused before it is deleted (decision 224). */
export const GUEST_IDLE_DAYS = 30;

/**
 * The daily clean-up of guests nobody uses (decision 224): a guest account (`users.is_anonymous`) with no heroes, so no
 * records, builds or board entries, and no use in `GUEST_IDLE_DAYS` days, is deleted. Use is its sessions'
 * `updated_at`: better-auth moves a website session's at each day of use, and `GET /api/account`, which the game calls
 * at every launch, moves a game session's (which better-auth never renews: decision 223's sessions do not expire).
 * A guest with no session at all counts from when it was made.
 *
 * One `DELETE` of the user rows: the foreign keys take the sessions, the profile and anything else with them, as an
 * account deletion does. At 04:15 (SCHEDULE_TZ, UTC by default), after the 03:30 backup. A guest with a hero is never
 * touched: its records stay until the player deletes the account.
 */
export class GuestCleanup {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  @Cron('15 4 * * *', { name: 'guest-cleanup' })
  async daily(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      this.logger.error('guest clean-up failed', { err: error });
    }
  }

  /** Deletes the unused guests with no records as of `now`, and answers how many. */
  async run(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - GUEST_IDLE_DAYS * 86_400_000);
    const removed = await this.db
      .delete(user)
      .where(
        and(
          eq(user.isAnonymous, true),
          lt(user.createdAt, cutoff),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(hero)
              .where(eq(hero.userId, user.id)),
          ),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(session)
              .where(
                and(
                  eq(session.userId, user.id),
                  gte(session.updatedAt, cutoff),
                ),
              ),
          ),
        ),
      )
      .returning({ id: user.id });
    this.logger.info('guest clean-up', {
      removed: removed.length,
      idleDays: GUEST_IDLE_DAYS,
    });
    return removed.length;
  }
}
