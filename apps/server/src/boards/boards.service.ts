import { HttpError, HttpStatusCode } from '@dunx/http';
import { CursorError, decodeCursor, encodeCursor, pageOf, type Page } from '@dunx/infra/pagination/cursor';
import { and, asc, desc, eq, getTableColumns, ne, sql, type SQL } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { friendship, hero, heroBuild, leaderboard, leaderboardEntry, profile, type HeroClass, type Leaderboard } from '../database/schema.js';
import type { BuildSnapshot } from '@gravoth/contracts';
import { Builds, toBuildView, type BuildView } from '../heroes/builds.service.js';
import { Heroes } from '../heroes/heroes.service.js';
import type { PageQuery } from '../http/page-query.js';
import { BuildCheck } from './build-check.js';
import { HARDCORE_PREFIX } from '@gravoth/contracts';
import type { BoardPage, BoardView, EntryView, Neighbourhood, SubmitResult, SubmitScore } from '@gravoth/contracts';
export type { BoardPage, BoardView, EntryView, Neighbourhood, SubmitResult, SubmitScore };

/** Which rows a read covers. */
interface Scope {
  readonly board: Leaderboard;
  /** The caller and their accepted friends only. */
  readonly friendsOf?: string | undefined;
  readonly heroClass?: HeroClass | undefined;
}

/** The position a cursor or a row stands at, in board order. */
interface Mark {
  readonly score: number;
  readonly achievedAt: Date;
  readonly id: string;
}

const HIDDEN = 'A hidden player';
const e = leaderboardEntry;
const entryColumns = getTableColumns(e);
/** Every build column but the rules checker's card, which only the build card route sends. */
const { card: _card, ...buildColumns } = getTableColumns(heroBuild);

export const toBoardView = (board: Leaderboard): BoardView => ({
  key: board.key,
  title: board.title,
  hardcore: board.hardcore,
  season: board.season,
  sort: board.sort,
  format: board.format,
  minScore: board.minScore,
  maxScore: board.maxScore,
});

/**
 * The boards (docs/online-plan.md, step 4): reads ranked by score, ties to the earlier score, then the row id, which
 * makes the order total, so a keyset cursor (`@dunx/infra/pagination`'s codec over score, time and id) pages without
 * gaps or repeats while scores keep arriving. Flagged rows never show. Every row carries its full build.
 */
export class Boards {
  constructor(
    private readonly db: Db,
    private readonly heroes: Heroes,
    private readonly builds: Builds,
    private readonly check: BuildCheck,
  ) {}

  async list(filter: { hardcore?: boolean | undefined; season?: number | undefined }): Promise<BoardView[]> {
    const rows = await this.db
      .select()
      .from(leaderboard)
      .where(
        and(
          filter.hardcore === undefined ? undefined : eq(leaderboard.hardcore, filter.hardcore),
          filter.season === undefined ? undefined : eq(leaderboard.season, filter.season),
        ),
      )
      .orderBy(asc(leaderboard.season), asc(leaderboard.hardcore), asc(leaderboard.id));
    return rows.map(toBoardView);
  }

  /** A board by the game's key: `hc_pit_floor`, or `pit_floor` with `hardcore`. */
  async resolve(key: string, hardcore: boolean | undefined, season: number): Promise<Leaderboard> {
    const twin = key.startsWith(HARDCORE_PREFIX);
    const base = twin ? key.slice(HARDCORE_PREFIX.length) : key;
    const [board] = await this.db
      .select()
      .from(leaderboard)
      .where(and(eq(leaderboard.key, base), eq(leaderboard.hardcore, twin || hardcore === true), eq(leaderboard.season, season)))
      .limit(1);
    if (board === undefined) throw new HttpError(HttpStatusCode.NOT_FOUND, 'BOARD_NOT_FOUND');
    return board;
  }

  /** The top of a board, `take` rows a page. */
  async read(board: Leaderboard, page: PageQuery, options: { caller?: string | undefined; friends: boolean; heroClass?: HeroClass | undefined }): Promise<BoardPage> {
    if (options.friends && options.caller === undefined) throw new HttpError(HttpStatusCode.UNAUTHORIZED, 'UNAUTHENTICATED');
    const scope: Scope = { board, friendsOf: options.friends ? options.caller : undefined, heroClass: options.heroClass };
    const cursor = page.cursor === undefined ? undefined : markOf(page.cursor);
    const backward = page.direction === 'backward' && cursor !== undefined;

    const fetched = await this.rows(scope, {
      where: cursor === undefined ? undefined : backward ? this.before(board, cursor) : this.after(board, cursor),
      reverse: backward,
      limit: page.take + 1,
    });
    const more = fetched.length > page.take;
    const rows = fetched.slice(0, page.take);
    if (backward) rows.reverse();
    const first = rows[0];
    const startRank = first === undefined ? 1 : (await this.countBefore(scope, markOfRow(first))) + 1;
    const entries = rows.map((row, i) => this.view(row, startRank + i, options.caller));
    return {
      board: toBoardView(board),
      entries: pageOf(entries, {
        take: page.take,
        hasNextPage: backward ? true : more,
        hasPreviousPage: backward ? more : cursor !== undefined,
        cursorOf: (entry) => encodeCursor(`${entry.score}|${entry.achievedAt}`, entry.id),
      }),
    };
  }

  /** The caller's best hero on the board, with its rank and `around` rows either side. */
  async around(board: Leaderboard, caller: string, around: number, options: { friends: boolean; heroClass?: HeroClass | undefined }): Promise<Neighbourhood> {
    const scope: Scope = { board, friendsOf: options.friends ? caller : undefined, heroClass: options.heroClass };
    const [mine] = await this.rows(scope, { where: eq(e.userId, caller), reverse: false, limit: 1 });
    if (mine === undefined) return { board: toBoardView(board), entry: null, neighbours: [] };
    const mark = markOfRow(mine);
    const rank = (await this.countBefore(scope, mark)) + 1;
    const above = (await this.rows(scope, { where: this.before(board, mark), reverse: true, limit: around })).reverse();
    const below = await this.rows(scope, { where: this.after(board, mark), reverse: false, limit: around });
    const entry = this.view(mine, rank, caller);
    return {
      board: toBoardView(board),
      entry,
      neighbours: [
        ...above.map((row, i) => this.view(row, rank - above.length + i, caller)),
        entry,
        ...below.map((row, i) => this.view(row, rank + 1 + i, caller)),
      ],
    };
  }

  /**
   * A score and the build that set it: the build is stored (or found, for a revision already sent), the rules checker
   * gives its verdict, and the hero's row on the board is written only when the score beats its best, in one
   * statement (`ON CONFLICT ... DO UPDATE ... WHERE`), so two submissions at once cannot both win.
   */
  async submit(userId: string, key: string, body: SubmitScore): Promise<SubmitResult> {
    const board = await this.resolve(key, undefined, body.season);
    const owner = await this.heroes.own(userId, body.heroId);
    if (owner.hardcore !== board.hardcore) throw new HttpError(HttpStatusCode.UNPROCESSABLE_ENTITY, 'HARDCORE_MISMATCH');
    if (body.score < board.minScore || body.score > board.maxScore) throw new HttpError(HttpStatusCode.UNPROCESSABLE_ENTITY, 'SCORE_OUT_OF_RANGE');

    const now = new Date();
    const claimed = body.achievedAt === undefined ? now : new Date(body.achievedAt);
    const achievedAt = claimed.getTime() > now.getTime() ? now : claimed;
    const checked = await this.check.check({ board, hero: owner, score: body.score, build: body.build, save: body.save, saveHeroId: body.saveHeroId });

    const outcome = await this.db.transaction(async (tx) => {
      const build = await this.builds.snapshot(tx, owner, body.build, checked);
      const better = board.sort === 'desc' ? sql`excluded.score > ${e.score}` : sql`excluded.score < ${e.score}`;
      const [written] = await tx
        .insert(e)
        .values({
          boardId: board.id,
          userId,
          heroId: owner.id,
          buildId: build.id,
          score: body.score,
          achievedAt,
          recordedAt: now,
          verdict: checked.verdict,
          verdictNote: checked.note,
        })
        .onConflictDoUpdate({
          target: [e.boardId, e.heroId],
          set: {
            buildId: sql`excluded.build_id`,
            score: sql`excluded.score`,
            achievedAt: sql`excluded.achieved_at`,
            recordedAt: sql`excluded.recorded_at`,
            verdict: sql`excluded.verdict`,
            verdictNote: sql`excluded.verdict_note`,
          },
          setWhere: better,
        })
        // `xmax` is 0 on a row this statement inserted, and set on one it updated.
        .returning({ ...entryColumns, inserted: sql<boolean>`(xmax = 0)` });
      if (written !== undefined) {
        const { inserted, ...row } = written;
        return { row, result: inserted ? ('new' as const) : ('improved' as const) };
      }
      const [kept] = await tx
        .select()
        .from(e)
        .where(and(eq(e.boardId, board.id), eq(e.heroId, owner.id)))
        .limit(1);
      if (kept === undefined) throw new Error('board entry vanished');
      return { row: kept, result: 'kept' as const };
    });

    const { row } = outcome;
    const rank = row.verdict === 'flagged' ? null : (await this.countBefore({ board }, { score: row.score, achievedAt: row.achievedAt, id: row.id })) + 1;
    return {
      result: outcome.result,
      board: toBoardView(board),
      entry: { id: row.id, score: row.score, buildId: row.buildId, verdict: row.verdict, verdictNote: row.verdictNote, rank },
    };
  }

  private async rows(scope: Scope, query: { where: SQL | undefined; reverse: boolean; limit: number }) {
    const ascending = (scope.board.sort === 'asc') !== query.reverse;
    const tie = query.reverse ? desc : asc;
    return this.db
      .select({ entry: e, hero, build: buildColumns, displayName: profile.displayName, publicProfile: profile.publicProfile })
      .from(e)
      .innerJoin(hero, eq(hero.id, e.heroId))
      .innerJoin(heroBuild, eq(heroBuild.id, e.buildId))
      .leftJoin(profile, eq(profile.userId, e.userId))
      .where(and(this.scoped(scope), query.where))
      .orderBy(ascending ? asc(e.score) : desc(e.score), tie(e.achievedAt), tie(e.id))
      .limit(query.limit);
  }

  private scoped(scope: Scope): SQL | undefined {
    const me = scope.friendsOf;
    return and(
      eq(e.boardId, scope.board.id),
      ne(e.verdict, 'flagged'),
      scope.heroClass === undefined ? undefined : eq(hero.class, scope.heroClass),
      me === undefined
        ? undefined
        : sql`(${e.userId} = ${me} OR ${e.userId} IN (
            SELECT CASE WHEN ${friendship.requesterId} = ${me} THEN ${friendship.addresseeId} ELSE ${friendship.requesterId} END
            FROM ${friendship}
            WHERE ${friendship.status} = 'accepted' AND (${friendship.requesterId} = ${me} OR ${friendship.addresseeId} = ${me})))`,
    );
  }

  /** Rows ranked above `mark`. */
  private before(board: Leaderboard, mark: Mark): SQL {
    const better = sql.raw(board.sort === 'desc' ? '>' : '<');
    return sql`(${e.score} ${better} ${mark.score} OR (${e.score} = ${mark.score} AND (${e.achievedAt} < ${mark.achievedAt} OR (${e.achievedAt} = ${mark.achievedAt} AND ${e.id} < ${mark.id}))))`;
  }

  /** Rows ranked below `mark`. */
  private after(board: Leaderboard, mark: Mark): SQL {
    const worse = sql.raw(board.sort === 'desc' ? '<' : '>');
    return sql`(${e.score} ${worse} ${mark.score} OR (${e.score} = ${mark.score} AND (${e.achievedAt} > ${mark.achievedAt} OR (${e.achievedAt} = ${mark.achievedAt} AND ${e.id} > ${mark.id}))))`;
  }

  private async countBefore(scope: Scope, mark: Mark): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(e)
      .innerJoin(hero, eq(hero.id, e.heroId))
      .where(and(this.scoped(scope), this.before(scope.board, mark)));
    return row?.n ?? 0;
  }

  private view(row: Awaited<ReturnType<Boards['rows']>>[number], rank: number, caller: string | undefined): EntryView {
    const visible = row.publicProfile !== false || row.entry.userId === caller;
    return {
      rank,
      id: row.entry.id,
      score: row.entry.score,
      achievedAt: row.entry.achievedAt.toISOString(),
      recordedAt: row.entry.recordedAt.toISOString(),
      verdict: row.entry.verdict === 'verified' ? 'verified' : 'pending',
      player: visible
        ? { userId: row.entry.userId, displayName: row.displayName ?? HIDDEN, hidden: false }
        : { userId: null, displayName: HIDDEN, hidden: true },
      hero: { id: row.hero.id, name: row.hero.name, class: row.hero.class, hardcore: row.hero.hardcore },
      build: toBuildView(row.build),
    };
  }
}

const markOfRow = (row: { entry: { score: number; achievedAt: Date; id: string } }): Mark => ({
  score: row.entry.score,
  achievedAt: row.entry.achievedAt,
  id: row.entry.id,
});

/**
 * A cursor this service minted: `<score>|<ISO time>` and the row id. Anything else is a 400 `INVALID_CURSOR`, raised
 * as an `HttpError` so the request log records the 400 the caller gets.
 */
const markOf = (cursor: string): Mark => {
  const invalid = () => new HttpError(HttpStatusCode.BAD_REQUEST, 'INVALID_CURSOR');
  let decoded;
  try {
    decoded = decodeCursor(cursor);
  } catch (error) {
    if (error instanceof CursorError) throw invalid();
    throw error;
  }
  const [score, at] = decoded.s.split('|');
  const achievedAt = new Date(at ?? '');
  if (score === undefined || !/^\d+$/.test(score) || Number.isNaN(achievedAt.getTime()) || !/^[0-9a-f-]{36}$/.test(decoded.i)) throw invalid();
  return { score: Number(score), achievedAt, id: decoded.i };
};
