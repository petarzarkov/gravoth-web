import { AuthContext } from '@dunx/auth';
import { HttpError, HttpStatusCode } from '@dunx/http';
import { paginate, type Page } from '@dunx/infra/pagination';
import { and, eq, or } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { block, friendship } from '../database/schema.js';
import { mapPage, type PageQuery } from '../http/page-query.js';
import { Profiles } from '../players/profiles.service.js';
import { displayNames, requireAccount } from './players.js';
import type { BlockView } from '@gravoth/contracts';
export type { BlockView };

/**
 * Blocks, one way. Blocking ends any friendship or request between the two in the same transaction; the blocked player
 * then finds the blocker's name unknown when asking to be friends (and, from step 6, cannot whisper them).
 */
export class Blocks {
  constructor(
    private readonly db: Db,
    private readonly context: AuthContext,
    private readonly profiles: Profiles,
  ) {}

  async block(displayName: string): Promise<BlockView> {
    const me = requireAccount(this.context);
    const target = await this.profiles.findByName(displayName);
    if (target === undefined) throw new HttpError(HttpStatusCode.NOT_FOUND, 'PLAYER_NOT_FOUND');
    if (target.userId === me.id) throw new HttpError(HttpStatusCode.BAD_REQUEST, 'CANNOT_BLOCK_SELF');
    const row = await this.db.transaction(async (tx) => {
      await tx
        .delete(friendship)
        .where(
          or(
            and(eq(friendship.requesterId, me.id), eq(friendship.addresseeId, target.userId)),
            and(eq(friendship.requesterId, target.userId), eq(friendship.addresseeId, me.id)),
          ),
        );
      const [inserted] = await tx.insert(block).values({ blockerId: me.id, blockedId: target.userId }).onConflictDoNothing().returning();
      if (inserted !== undefined) return inserted;
      const [existing] = await tx
        .select()
        .from(block)
        .where(and(eq(block.blockerId, me.id), eq(block.blockedId, target.userId)))
        .limit(1);
      return existing;
    });
    if (row === undefined) throw new Error('block not stored');
    return { userId: target.userId, displayName: target.displayName, blockedAt: row.createdAt.toISOString() };
  }

  async unblock(userId: string): Promise<void> {
    const me = requireAccount(this.context);
    const gone = await this.db
      .delete(block)
      .where(and(eq(block.blockerId, me.id), eq(block.blockedId, userId)))
      .returning({ blockedId: block.blockedId });
    if (gone.length === 0) throw new HttpError(HttpStatusCode.NOT_FOUND, 'BLOCK_NOT_FOUND');
  }

  /** Whom the caller blocked, newest first. */
  async list(page: PageQuery): Promise<Page<BlockView>> {
    const me = requireAccount(this.context);
    const rows = await paginate<typeof block, typeof block.$inferSelect>({
      db: this.db,
      table: block,
      options: { ...page, order: 'desc' },
      where: eq(block.blockerId, me.id),
      orderBy: 'createdAt',
      idColumn: 'blockedId',
    });
    return mapPage(rows, async (data) => {
      const names = await displayNames(this.db, data.map((row) => row.blockedId));
      return data.map((row) => ({ userId: row.blockedId, displayName: names.get(row.blockedId) ?? '', blockedAt: row.createdAt.toISOString() }));
    });
  }
}
