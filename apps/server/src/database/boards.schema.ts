import { sql } from 'drizzle-orm';
import { bigint, boolean, check, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.schema.js';
import { hero, heroBuild } from './heroes.schema.js';

/**
 * One board: the game's key (`pit_floor`, `map_s16`, ...; `Gravoth.Core.Feats.Boards`), normal or hardcore, in a
 * season (0 is the permanent board). Its rows come from boards/catalog.ts at boot, so a board, a season or a limit is
 * a line of code and not a console form.
 */
export const leaderboard = pgTable(
  'leaderboards',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    key: text('key').notNull(),
    hardcore: boolean('hardcore').notNull().default(false),
    season: integer('season').notNull().default(0),
    title: text('title').notNull(),
    /** `desc`: a larger score ranks higher (a deeper floor). `asc`: a smaller one does (a faster time). */
    sort: text('sort', { enum: ['asc', 'desc'] }).notNull(),
    /** `number`, or `time_ms` for milliseconds shown as a time. */
    format: text('format', { enum: ['number', 'time_ms'] }).notNull(),
    minScore: bigint('min_score', { mode: 'number' }).notNull(),
    maxScore: bigint('max_score', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('leaderboards_key_hardcore_season_key').on(t.key, t.hardcore, t.season),
    check('leaderboards_key_format', sql`${t.key} ~ '^[a-z][a-z0-9_]{1,39}$' AND ${t.key} NOT LIKE 'hc\\_%'`),
    check('leaderboards_sort', sql`${t.sort} IN ('asc', 'desc')`),
    check('leaderboards_format', sql`${t.format} IN ('number', 'time_ms')`),
    check('leaderboards_season', sql`${t.season} >= 0`),
    check('leaderboards_range', sql`${t.minScore} <= ${t.maxScore}`),
  ],
);

/**
 * A hero's best on a board, with the build it was set with: one row per board and hero, replaced only by a better
 * score. Every row of a board therefore opens the full build that made it.
 *
 * The keys hold the relations together: the entry's player is its hero's owner (`(hero_id, user_id)` references the
 * hero), and its build is that hero's (`(build_id, hero_id)` references the build). Deleting the player deletes their
 * heroes, builds and entries in one statement; a build cannot be deleted while an entry stands on it.
 *
 * `verdict`: `verified` when the rules checker read the hero's save and the build is its own, `pending` while it could
 * not (shown, rechecked later), `flagged` when the check failed (kept for review, never shown).
 */
export const leaderboardEntry = pgTable(
  'leaderboard_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: integer('board_id')
      .notNull()
      .references(() => leaderboard.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    heroId: uuid('hero_id').notNull(),
    buildId: uuid('build_id').notNull(),
    score: bigint('score', { mode: 'number' }).notNull(),
    /** When the hero set the score (the device's clock, never later than the server's). */
    achievedAt: timestamp('achieved_at', { withTimezone: true }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    verdict: text('verdict', { enum: ['pending', 'verified', 'flagged'] }).notNull().default('pending'),
    /** Why the rules checker flagged it, or what it could not do. */
    verdictNote: text('verdict_note'),
  },
  (t) => [
    unique('leaderboard_entries_board_hero_key').on(t.boardId, t.heroId),
    foreignKey({ name: 'leaderboard_entries_hero_fk', columns: [t.heroId, t.userId], foreignColumns: [hero.id, hero.userId] })
      .onDelete('cascade')
      .onUpdate('cascade'),
    foreignKey({ name: 'leaderboard_entries_build_fk', columns: [t.buildId, t.heroId], foreignColumns: [heroBuild.id, heroBuild.heroId] })
      .onDelete('no action')
      .onUpdate('no action'),
    check('leaderboard_entries_verdict', sql`${t.verdict} IN ('pending', 'verified', 'flagged')`),
    check('leaderboard_entries_achieved', sql`${t.achievedAt} <= ${t.recordedAt}`),
    // The two orders a board ranks in: larger first, or smaller first; ties go to the earlier score.
    index('leaderboard_entries_rank_desc_idx').on(t.boardId, t.score.desc(), t.achievedAt, t.id),
    index('leaderboard_entries_rank_asc_idx').on(t.boardId, t.score.asc(), t.achievedAt, t.id),
    index('leaderboard_entries_user_idx').on(t.userId),
    index('leaderboard_entries_hero_idx').on(t.heroId, t.userId),
    index('leaderboard_entries_build_idx').on(t.buildId),
  ],
);

export type Leaderboard = typeof leaderboard.$inferSelect;
export type LeaderboardEntry = typeof leaderboardEntry.$inferSelect;
