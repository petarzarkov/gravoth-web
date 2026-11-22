import { HttpError, HttpStatusCode } from '@dunx/http';
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { Db } from '../database/db.js';
import {
  friendship,
  hero,
  heroBuild,
  leaderboard,
  leaderboardEntry,
  profile,
  user,
} from '../database/schema.js';
import { shownEntry } from '../boards/shown.js';
import { avatarView } from '../players/avatars.js';
import { toBuildView } from './builds.service.js';
import { toHeroView } from './heroes.service.js';
import {
  HARDCORE_PREFIX,
  type PlayerHero,
  type PlayerPage,
  type PlayerRecord,
} from '@gravoth/contracts';
export type { PlayerPage };

const e = leaderboardEntry;
/** Every build column but the rules checker's card, as a board row carries a build. */
const { card: _card, ...buildColumns } = getTableColumns(heroBuild);

/**
 * Player pages (decision 226): all of a player's heroes, the way the boards show one (its newest build, extras and
 * all) with the records it holds and its rank on each. Anyone may look, a guest's heroes included; a hidden profile
 * (`publicProfile` false) shows its page to friends and the player only, and to anyone else it is no player at all.
 */
export class PlayerPages {
  constructor(private readonly db: Db) {}

  async page(userId: string, caller: string | undefined): Promise<PlayerPage> {
    const [owner] = await this.db
      .select({ profile, image: user.image })
      .from(user)
      .innerJoin(profile, eq(profile.userId, user.id))
      .where(eq(user.id, userId))
      .limit(1);
    if (owner === undefined)
      throw new HttpError(HttpStatusCode.NOT_FOUND, 'PLAYER_NOT_FOUND');
    const hidden = !owner.profile.publicProfile;
    if (hidden && caller !== userId && !(await this.friends(userId, caller)))
      throw new HttpError(HttpStatusCode.NOT_FOUND, 'PLAYER_NOT_FOUND');

    const heroes = await this.db
      .select()
      .from(hero)
      .where(and(eq(hero.userId, userId), isNull(hero.retiredAt)));
    const ids = heroes.map((row) => row.id);
    const builds = new Map(
      (ids.length === 0
        ? []
        : await this.db
            .selectDistinctOn([heroBuild.heroId], buildColumns)
            .from(heroBuild)
            .where(inArray(heroBuild.heroId, ids))
            .orderBy(
              heroBuild.heroId,
              desc(heroBuild.revision),
              desc(heroBuild.createdAt),
            )
      ).map((row) => [row.heroId, toBuildView(row)]),
    );
    const records = await this.records(userId, ids);
    const list: PlayerHero[] = heroes.map((row) => ({
      hero: toHeroView(row),
      build: builds.get(row.id) ?? null,
      records: records.get(row.id) ?? [],
    }));
    list.sort(
      (a, b) =>
        (b.build?.level ?? 0) - (a.build?.level ?? 0) ||
        a.hero.name.localeCompare(b.hero.name, 'en', { sensitivity: 'base' }) ||
        a.hero.id.localeCompare(b.hero.id),
    );
    return {
      player: {
        userId,
        displayName: owner.profile.displayName,
        avatar: avatarView(owner.profile, owner.image),
        hidden,
      },
      heroes: list,
    };
  }

  /** Whether the two are accepted friends. */
  private async friends(a: string, b: string | undefined): Promise<boolean> {
    if (b === undefined) return false;
    const [row] = await this.db
      .select({ one: sql`1` })
      .from(friendship)
      .where(
        and(
          eq(friendship.status, 'accepted'),
          or(
            and(eq(friendship.requesterId, a), eq(friendship.addresseeId, b)),
            and(eq(friendship.requesterId, b), eq(friendship.addresseeId, a)),
          ),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /**
   * The shown entries of these heroes, each with its rank on its board as the board ranks it (the better score, then
   * the earlier, then the row id), counted over the board's shown entries.
   */
  private async records(
    userId: string,
    heroIds: readonly string[],
  ): Promise<Map<string, PlayerRecord[]>> {
    const found = new Map<string, PlayerRecord[]>();
    if (heroIds.length === 0) return found;
    const boards = this.db
      .selectDistinct({ id: e.boardId })
      .from(e)
      .where(eq(e.userId, userId));
    const ranked = this.db
      .select({
        heroId: sql<string>`${e.heroId}`.as('hero_id'),
        key: sql<string>`${leaderboard.key}`.as('key'),
        hardcore: sql<boolean>`${leaderboard.hardcore}`.as('hardcore'),
        boardId: sql<number>`${e.boardId}`.as('board_id'),
        score: sql<number>`${e.score}`.as('score'),
        rank: sql<number>`(row_number() over (partition by ${e.boardId} order by case when ${leaderboard.sort} = 'desc' then -${e.score} else ${e.score} end, ${e.achievedAt}, ${e.id}))::int`.as(
          'rank',
        ),
      })
      .from(e)
      .innerJoin(leaderboard, eq(leaderboard.id, e.boardId))
      .innerJoin(hero, eq(hero.id, e.heroId))
      .where(and(shownEntry(), inArray(e.boardId, boards)))
      .as('ranked');
    const rows = await this.db
      .select()
      .from(ranked)
      .where(inArray(ranked.heroId, [...heroIds]))
      .orderBy(asc(ranked.boardId));
    for (const row of rows) {
      const list = found.get(row.heroId) ?? [];
      list.push({
        board: row.hardcore ? `${HARDCORE_PREFIX}${row.key}` : row.key,
        score: Number(row.score),
        rank: row.rank,
      });
      found.set(row.heroId, list);
    }
    return found;
  }
}
