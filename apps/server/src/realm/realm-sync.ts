import { Logger } from '@dunx/core';
import {
  BuildSnapshot,
  HARDCORE_PREFIX,
  HERO_CLASSES,
  type HeroClass,
} from '@gravoth/contracts';
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { Db } from '../database/db.js';
import {
  hero,
  leaderboard,
  leaderboardEntry,
  realm,
  type Hero,
  type HeroBuild,
  type Leaderboard,
} from '../database/schema.js';
import {
  ValidatorClient,
  type HeroCheck,
} from '../gravoth/validator.client.js';
import { Builds, buildHash } from '../heroes/builds.service.js';

const isHeroClass = (value: string): value is HeroClass =>
  (HERO_CLASSES as readonly string[]).includes(value);

const e = leaderboardEntry;

/**
 * Decision 227: what follows an accepted realm upload, after the reply. The rules checker reads the realm
 * (`/saves/heroes`), and for each hero in it:
 *
 * - its `heroes` row, made or brought up to date by its id in the realm (`realm_character_id`): online, name, class,
 *   hardcore, level, and `flagged` with the checker's reasons when it is not plausible (kept, never on the boards);
 * - a new build when its snapshot changed (Core's BuildSnapshotJson from `/saves/snapshot`, with the checker's own
 *   numbers and build card, at the hero's next revision);
 * - its board records from the realm (the save's witnessed bests: ranked, plausible, a witness the checker does not
 *   refuse), each written as a verified entry with that build when it beats the hero's entry there.
 *
 * Online heroes no longer in the realm are retired (their builds and records stay). A realm that does not read flags
 * every online hero of the account; a checker that is down or older than the game leaves the realm unchecked until
 * the next upload. One account's checks run one at a time, each reading the realm as it then is, so two uploads in a
 * row never race and a superseded one is skipped.
 */
export class RealmSync {
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly validator: ValidatorClient,
    private readonly builds: Builds,
    private readonly logger: Logger,
  ) {}

  /** Checks the account's realm after whatever check of it is running now. Never throws. */
  schedule(userId: string): void {
    const before = this.running.get(userId) ?? Promise.resolve();
    const next = before
      .then(() => this.run(userId))
      .catch((error: unknown) =>
        this.logger.error('realm check failed', { userId, err: error }),
      );
    this.running.set(userId, next);
    void next.finally(() => {
      if (this.running.get(userId) === next) this.running.delete(userId);
    });
  }

  /** Resolves once every check scheduled for the account has run. */
  async settled(userId: string): Promise<void> {
    await (this.running.get(userId) ?? Promise.resolve());
  }

  /** One read of the account's realm by the rules checker, landed on its heroes and the boards. */
  async run(userId: string): Promise<void> {
    const [stored] = await this.db
      .select({
        data: realm.data,
        revision: realm.revision,
        checkedRevision: realm.checkedRevision,
        gameVersion: realm.gameVersion,
      })
      .from(realm)
      .where(eq(realm.userId, userId))
      .limit(1);
    if (
      stored === undefined ||
      stored.data === null ||
      stored.checkedRevision >= stored.revision
    )
      return;
    const text = Buffer.from(stored.data).toString('utf8');
    let report;
    try {
      report = await this.validator.heroes(text);
    } catch (error) {
      this.logger.warn('the rules checker did not read a realm', {
        userId,
        revision: stored.revision,
        err: error,
      });
      return;
    }
    const now = new Date();
    if (!report.ok) {
      if (report.needsNewerBuild) {
        this.logger.warn('a realm needs a newer rules checker', {
          userId,
          revision: stored.revision,
          needs: report.needs,
        });
        return;
      }
      const flagged = await this.db
        .update(hero)
        .set({
          flagged: true,
          flagNote: 'the realm does not read',
          updatedAt: now,
        })
        .where(and(eq(hero.userId, userId), eq(hero.online, true)))
        .returning({ id: hero.id });
      this.logger.warn('realm does not read: its heroes flagged', {
        userId,
        revision: stored.revision,
        heroes: flagged.length,
        warnings: report.warnings.slice(0, 5),
      });
      await this.checked(userId, stored.revision);
      return;
    }

    const boards = await this.boards();
    const seen: number[] = [];
    for (const checked of report.heroes) {
      if (!isHeroClass(checked.class)) {
        this.logger.warn('realm hero of an unknown class skipped', {
          userId,
          characterId: checked.characterId,
          class: checked.class,
        });
        continue;
      }
      seen.push(checked.characterId);
      const row = await this.hero(userId, checked, checked.class, now);
      if (row.flagged)
        this.logger.warn('online hero flagged', {
          userId,
          heroId: row.id,
          reasons: checked.reasons,
        });
      const build = await this.build(
        row,
        text,
        checked,
        stored.gameVersion ?? '0.0.0',
      );
      if (build !== undefined && !row.flagged)
        await this.records(row, build, checked, boards, now);
    }
    await this.db
      .update(hero)
      .set({ retiredAt: now, updatedAt: now })
      .where(
        and(
          eq(hero.userId, userId),
          eq(hero.online, true),
          isNull(hero.retiredAt),
          seen.length === 0
            ? undefined
            : notInArray(hero.realmCharacterId, seen),
        ),
      );
    await this.checked(userId, stored.revision);
  }

  private async checked(userId: string, revision: number): Promise<void> {
    await this.db
      .update(realm)
      .set({
        checkedRevision: sql`greatest(${realm.checkedRevision}, ${revision})`,
      })
      .where(eq(realm.userId, userId));
  }

  /** The hero's row by its id in the realm, made now or brought up to date. */
  private async hero(
    userId: string,
    checked: HeroCheck,
    heroClass: HeroClass,
    now: Date,
  ): Promise<Hero> {
    const name = checked.name.trim().slice(0, 24).trim() || 'Hero';
    const state = {
      name,
      class: heroClass,
      hardcore: checked.hardcore,
      online: true,
      level: Math.max(1, Math.min(32_767, Math.round(checked.level))),
      flagged: !checked.plausible,
      flagNote: checked.plausible
        ? null
        : checked.reasons.join('; ').slice(0, 2000) || 'not plausible',
      retiredAt: null,
      updatedAt: now,
    };
    const [row] = await this.db
      .insert(hero)
      .values({ userId, realmCharacterId: checked.characterId, ...state })
      .onConflictDoUpdate({
        target: [hero.userId, hero.realmCharacterId],
        targetWhere: sql`${hero.realmCharacterId} IS NOT NULL`,
        set: state,
      })
      .returning();
    if (row === undefined) throw new Error('realm hero not stored');
    return row;
  }

  /**
   * The hero's newest build: a new one at its next revision when the checker's snapshot of it changed, else the one
   * it has. Undefined when it has none and the checker could not make one.
   */
  private async build(
    owner: Hero,
    text: string,
    checked: HeroCheck,
    gameVersion: string,
  ): Promise<HeroBuild | undefined> {
    const latest = await this.builds.latest(owner.id);
    let snapshot;
    try {
      snapshot = await this.validator.snapshot(
        text,
        checked.characterId,
        gameVersion,
      );
    } catch (error) {
      this.logger.warn('no build snapshot from the rules checker', {
        heroId: owner.id,
        err: error,
      });
      return latest;
    }
    const parsed = BuildSnapshot.safeParse(snapshot);
    if (!parsed.success) {
      if (snapshot !== null)
        this.logger.warn('a build snapshot the contract refuses', {
          heroId: owner.id,
          issues: parsed.error.issues.slice(0, 5),
        });
      return latest;
    }
    if (
      latest !== undefined &&
      buildHash({ ...parsed.data, revision: latest.revision }) ===
        latest.contentHash
    )
      return latest;
    const build = {
      ...parsed.data,
      revision: latest === undefined ? 0 : latest.revision + 1,
    };
    let card;
    try {
      card =
        (await this.validator.card(text, checked.characterId)) ?? undefined;
    } catch {
      card = undefined;
    }
    const summary = {
      dps: checked.dps,
      clearDps: checked.clearDps,
      ehp: checked.ehp,
      life: Math.round(checked.life),
    };
    return (
      await this.db.transaction((tx) =>
        this.builds.store(tx, owner, build, { summary, card }),
      )
    ).build;
  }

  /** The hero's records from the realm, each a verified entry with `build` where it beats the hero's entry. */
  private async records(
    owner: Hero,
    build: HeroBuild,
    checked: HeroCheck,
    boards: ReadonlyMap<string, Leaderboard>,
    now: Date,
  ): Promise<void> {
    for (const record of checked.records) {
      if (!record.ranked || !record.plausible || record.witness === 'invalid')
        continue;
      const board = boards.get(record.board);
      if (
        board === undefined ||
        board.hardcore !== owner.hardcore ||
        record.score < board.minScore ||
        record.score > board.maxScore
      )
        continue;
      const better =
        board.sort === 'desc'
          ? sql`excluded.score > ${e.score}`
          : sql`excluded.score < ${e.score}`;
      await this.db
        .insert(e)
        .values({
          boardId: board.id,
          userId: owner.userId,
          heroId: owner.id,
          buildId: build.id,
          score: record.score,
          achievedAt: now,
          recordedAt: now,
          verdict: 'verified',
          verdictNote: null,
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
          setWhere: sql`${better} OR ${e.verdict} <> 'verified'`,
        });
    }
  }

  /** Season 0's boards by the game's key (`pit_floor`, `hc_pit_floor`). */
  private async boards(): Promise<Map<string, Leaderboard>> {
    const rows = await this.db
      .select()
      .from(leaderboard)
      .where(eq(leaderboard.season, 0));
    return new Map(
      rows.map((row) => [
        row.hardcore ? `${HARDCORE_PREFIX}${row.key}` : row.key,
        row,
      ]),
    );
  }
}
