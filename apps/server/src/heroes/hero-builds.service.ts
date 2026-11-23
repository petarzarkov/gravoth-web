import { Logger } from '@dunx/core';
import { HttpError, HttpStatusCode } from '@dunx/http';
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
} from 'drizzle-orm';
import { Db } from '../database/db.js';
import { cloudSave, hero } from '../database/schema.js';
import { ValidatorClient } from '../gravoth/validator.client.js';
import { Builds, buildHash, type BuildView } from './builds.service.js';
import { Heroes } from './heroes.service.js';
import type { CardPage, PostHeroBuild } from '@gravoth/contracts';
import type { HeroBuild } from '../database/schema.js';

/**
 * Decision 226: every hero's build, for its player page. The game sends a hero's build whenever it changes (the same
 * builds service the score route uses: a revision once, immutable), and tells the server which offline heroes are still
 * on the phone, so a deleted or moved one leaves the page. An online hero's builds and life are its realm's (decision
 * 227): it is refused here (409 `HERO_ONLINE`) and never retired here.
 */
export class HeroBuilds {
  constructor(
    private readonly db: Db,
    private readonly heroes: Heroes,
    private readonly builds: Builds,
    private readonly validator: ValidatorClient,
    private readonly logger: Logger,
  ) {}

  /**
   * The hero's build: stored, unless it is the hero's latest build already (answered with `created: false`). Posting
   * a hero's build brings a retired hero back (it is on the phone again).
   */
  async post(
    userId: string,
    heroId: string,
    body: PostHeroBuild,
  ): Promise<{ build: HeroBuild; created: boolean }> {
    const owner = await this.heroes.own(userId, heroId);
    if (owner.online)
      throw new HttpError(HttpStatusCode.CONFLICT, 'HERO_ONLINE');
    if (owner.retiredAt !== null)
      await this.db
        .update(hero)
        .set({ retiredAt: null, updatedAt: new Date() })
        .where(eq(hero.id, owner.id));
    const latest = await this.builds.latest(owner.id);
    if (latest !== undefined && latest.contentHash === buildHash(body.build))
      return { build: latest, created: false };
    const card = await this.card(userId, body);
    return this.db.transaction((tx) =>
      this.builds.store(tx, owner, body.build, { card }),
    );
  }

  /**
   * The offline heroes the phone still has: they come back if retired, and (decision 229) with `deviceId` the phone
   * claims them. The caller's other offline heroes are retired (their builds and records stay), but only the ones this
   * phone holds or no phone has claimed: another phone's heroes are that phone's to retire. Without `deviceId` (a game
   * before decision 229) only the unclaimed ones. Answers how many this call retired.
   */
  async active(
    userId: string,
    heroIds: readonly string[],
    deviceId?: string,
  ): Promise<number> {
    const listed = [...new Set(heroIds)];
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const offline = and(eq(hero.userId, userId), eq(hero.online, false));
      const ours =
        deviceId === undefined
          ? isNull(hero.deviceId)
          : or(isNull(hero.deviceId), eq(hero.deviceId, deviceId));
      const retired = await tx
        .update(hero)
        .set({ retiredAt: now, updatedAt: now })
        .where(
          and(
            offline,
            ours,
            isNull(hero.retiredAt),
            listed.length === 0 ? undefined : notInArray(hero.id, listed),
          ),
        )
        .returning({ id: hero.id });
      if (listed.length > 0) {
        await tx
          .update(hero)
          .set({ retiredAt: null, updatedAt: now })
          .where(
            and(offline, isNotNull(hero.retiredAt), inArray(hero.id, listed)),
          );
        if (deviceId !== undefined)
          await tx
            .update(hero)
            .set({ deviceId, updatedAt: now })
            .where(
              and(
                offline,
                inArray(hero.id, listed),
                or(isNull(hero.deviceId), ne(hero.deviceId, deviceId)),
              ),
            );
      }
      return retired.length;
    });
  }

  /**
   * The rules checker's build card for the hero `saveHeroId`: from the save sent with the build, else the account's
   * cloud save (decision 225, the game's GRAVOTH-SAVE block, which the checker reads too). None without `saveHeroId`,
   * without a save, or when the checker cannot answer: the build is stored without it.
   */
  private async card(
    userId: string,
    body: PostHeroBuild,
  ): Promise<CardPage[] | undefined> {
    if (body.saveHeroId === undefined) return undefined;
    let save = body.save;
    if (save === undefined) {
      const [row] = await this.db
        .select({ data: cloudSave.data })
        .from(cloudSave)
        .where(eq(cloudSave.userId, userId))
        .limit(1);
      if (row === undefined) return undefined;
      save = Buffer.from(row.data).toString('utf8');
    }
    try {
      return (await this.validator.card(save, body.saveHeroId)) ?? undefined;
    } catch (error) {
      this.logger.warn('build card not made', { userId, err: error });
      return undefined;
    }
  }
}

export type { BuildView };
