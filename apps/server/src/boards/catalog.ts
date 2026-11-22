import { Logger, type OnInit } from '@dunx/core';
import { sql } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { leaderboard } from '../database/schema.js';

export interface BoardDefinition {
  readonly key: string;
  readonly title: string;
  readonly sort: 'asc' | 'desc';
  readonly format: 'number' | 'time_ms';
  readonly minScore: number;
  readonly maxScore: number;
}

/** The hardcore twin's prefix on the game's keys (`hc_pit_floor`, `Gravoth.Core.Feats.Boards.HardcorePrefix`). */
export const HARDCORE_PREFIX = 'hc_';

/**
 * The boards, from the game's own definitions (`Gravoth.Core.Feats.Boards`: keys, names, orders and Play Console's
 * limits), each with a hardcore twin ("Hardcore deepest Bone Pit floor"), all in season 0, the permanent one. A new
 * board or season is a line here; a published board's order and format never change (the upsert leaves them).
 */
export const BOARDS: readonly BoardDefinition[] = [
  { key: 'pit_floor', title: 'Deepest Bone Pit floor', sort: 'desc', format: 'number', minScore: 1, maxScore: 9_999 },
  { key: 'chart_tier', title: 'Highest chart tier', sort: 'desc', format: 'number', minScore: 1, maxScore: 16 },
  { key: 'map_s16', title: 'Fastest S16 map clear', sort: 'asc', format: 'time_ms', minScore: 1, maxScore: 86_400_000 },
  { key: 'marks', title: 'Most Marks', sort: 'desc', format: 'number', minScore: 1, maxScore: 99_999 },
  { key: 'first_voice', title: 'Fastest First Voice kill', sort: 'asc', format: 'time_ms', minScore: 30_000, maxScore: 86_400_000 },
];

const hardcoreTitle = (title: string): string => `Hardcore ${title.charAt(0).toLowerCase()}${title.slice(1)}`;

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
