import { Logger, type OnInit } from '@dunx/core';
import { sql } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { leaderboard } from '../database/schema.js';
import { BOARDS, HARDCORE_PREFIX, hardcoreTitle, type BoardDefinition } from '@gravoth/contracts';

export { BOARDS, HARDCORE_PREFIX, type BoardDefinition };

/** Every board row: each definition, normal and hardcore, in season 0. */
export const boardRows = () =>
  BOARDS.flatMap((board) => [
    { ...board, hardcore: false, season: 0 },
    { ...board, title: hardcoreTitle(board.title), hardcore: true, season: 0 },
  ]);

/** Writes the catalog at boot (after the migrations), so the boards in the database are the ones in the code. */
export class BoardCatalog implements OnInit {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  async onInit(): Promise<void> {
    const rows = boardRows();
    await this.db
      .insert(leaderboard)
      .values(rows)
      .onConflictDoUpdate({
        target: [leaderboard.key, leaderboard.hardcore, leaderboard.season],
        set: { title: sql`excluded.title`, minScore: sql`excluded.min_score`, maxScore: sql`excluded.max_score` },
      });
    this.logger.info('boards ready', { boards: rows.length });
  }
}
