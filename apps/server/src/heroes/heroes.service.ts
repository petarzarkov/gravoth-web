import { HttpError, HttpStatusCode } from '@dunx/http';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { isUniqueViolation } from '../database/errors.js';
import { hero, type Hero } from '../database/schema.js';
import { maskName } from '../players/profanity.js';
import type { HeroView, RegisterHero } from '@gravoth/contracts';
export type { HeroView, RegisterHero };

/** Decision 230: a title as the game sent it (Warrior, an ascendancy's name), at most 40 characters, or null. */
export const titleOf = (title: unknown): string | null =>
  typeof title === 'string' && title.trim().length > 0
    ? title.trim().slice(0, 40)
    : null;

export const toHeroView = (row: Hero): HeroView => ({
  id: row.id,
  name: row.name,
  class: row.class,
  title: row.title,
  path: row.path,
  hardcore: row.hardcore,
  online: row.online,
  createdAt: row.createdAt.toISOString(),
});

/**
 * The heroes a player has told the server about. An offline hero is registered so its builds show on its player page:
 * registering is idempotent by name among the player's offline heroes (the same hero after a reinstall finds its row
 * again), a name is one offline hero per player, and the device is the authority on hardcore (a hardcore hero that
 * falls becomes normal; MAKE HARDCORE goes the other way once, decision 198). Online heroes are the realm's
 * (decision 227, `realm/realm-sync.ts`): registering never finds one.
 */
export class Heroes {
  constructor(private readonly db: Db) {}

  async register(
    userId: string,
    registering: RegisterHero,
  ): Promise<{ hero: Hero; created: boolean }> {
    // Decision 229: a name made before the game asked (or on a phone that never could) is kept with its profane words masked.
    const input = { ...registering, name: maskName(registering.name) };
    const existing = await this.byName(userId, input.name);
    if (existing !== undefined)
      return { hero: await this.reconcile(existing, input), created: false };
    try {
      const [row] = await this.db
        .insert(hero)
        .values({
          userId,
          name: input.name,
          class: input.class,
          hardcore: input.hardcore,
          deviceId: input.deviceId ?? null,
        })
        .returning();
      if (row === undefined) throw new Error('hero not stored');
      return { hero: row, created: true };
    } catch (error) {
      // Two registrations of one hero at once: the unique index kept one.
      if (!isUniqueViolation(error, 'heroes_user_name_key')) throw error;
      const raced = await this.byName(userId, input.name);
      if (raced === undefined) throw error;
      return { hero: await this.reconcile(raced, input), created: false };
    }
  }

  /** The caller's heroes still in play: an offline hero retired (moved online, or gone from the phone) is left out. */
  async mine(userId: string): Promise<Hero[]> {
    return this.db
      .select()
      .from(hero)
      .where(and(eq(hero.userId, userId), isNull(hero.retiredAt)))
      .orderBy(asc(hero.createdAt), asc(hero.id));
  }

  async find(id: string): Promise<Hero | undefined> {
    const [row] = await this.db
      .select()
      .from(hero)
      .where(eq(hero.id, id))
      .limit(1);
    return row;
  }

  /** The caller's own hero, or a 404 (another player's hero is not the caller's to post with). */
  async own(userId: string, id: string): Promise<Hero> {
    const [row] = await this.db
      .select()
      .from(hero)
      .where(and(eq(hero.id, id), eq(hero.userId, userId)))
      .limit(1);
    if (row === undefined)
      throw new HttpError(HttpStatusCode.NOT_FOUND, 'HERO_NOT_FOUND');
    return row;
  }

  private async byName(
    userId: string,
    name: string,
  ): Promise<Hero | undefined> {
    const [row] = await this.db
      .select()
      .from(hero)
      .where(
        and(
          eq(hero.userId, userId),
          eq(hero.online, false),
          sql`lower(${hero.name}) = lower(${name})`,
        ),
      )
      .limit(1);
    return row;
  }

  /** The registered hero as the phone says it is: its hardcore flag, and (decision 229) the phone that holds it. */
  private async reconcile(existing: Hero, input: RegisterHero): Promise<Hero> {
    if (existing.class !== input.class)
      throw new HttpError(HttpStatusCode.CONFLICT, 'HERO_NAME_TAKEN');
    const claim =
      input.deviceId !== undefined && existing.deviceId !== input.deviceId;
    if (existing.hardcore === input.hardcore && !claim) return existing;
    const [row] = await this.db
      .update(hero)
      .set({
        hardcore: input.hardcore,
        ...(claim ? { deviceId: input.deviceId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(hero.id, existing.id))
      .returning();
    return row ?? existing;
  }
}
