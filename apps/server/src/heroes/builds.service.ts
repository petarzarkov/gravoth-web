import type { SqlTransaction } from '@dunx/infra/db';
import { HttpError, HttpStatusCode } from '@dunx/http';
import { and, desc, eq } from 'drizzle-orm';
import { Db } from '../database/db.js';
import {
  hero,
  heroBuild,
  profile,
  user,
  type Hero,
  type HeroBuild,
} from '../database/schema.js';
import { avatarView } from '../players/avatars.js';
import type * as schema from '../database/schema.js';
import type { BuildSnapshot, BuildSummary, CardPage } from '@gravoth/contracts';
import { toHeroView } from './heroes.service.js';
import type { BuildCard, BuildView } from '@gravoth/contracts';
export type { BuildCard, BuildView };

/** What the rules checker worked out for a build, laid over what the game sent. */
export interface CheckedNumbers {
  readonly summary?:
    | Partial<Pick<BuildSummary, 'dps' | 'clearDps' | 'ehp' | 'life'>>
    | undefined;
  readonly card?: CardPage[] | undefined;
}

export const toBuildView = (row: Omit<HeroBuild, 'card'>): BuildView => ({
  id: row.id,
  heroId: row.heroId,
  revision: row.revision,
  gameVersion: row.gameVersion,
  level: row.level,
  ascendancy: row.ascendancy,
  dps: row.dps,
  clearDps: row.clearDps,
  ehp: row.ehp,
  life: row.life,
  energyShield: row.energyShield,
  skills: row.skills,
  gear: row.gear,
  talents: row.talents,
  atlas: row.atlas,
  auras: row.auras,
  extras: row.extras,
  summary: row.summary,
  createdAt: row.createdAt.toISOString(),
});

/** JSON with its keys sorted at every level, so one build always hashes the same. */
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

export const buildHash = (build: BuildSnapshot): string =>
  new Bun.CryptoHasher('sha256').update(canonical(build)).digest('hex');

/**
 * Hero builds: immutable snapshots (a trigger refuses every UPDATE), one per hero and revision. Posting the same
 * build at a revision again finds the row it made; a different build at a revision already stored is refused, since
 * a board row must keep showing the build that set it.
 */
export class Builds {
  constructor(private readonly db: Db) {}

  /** The hero's build at `build.revision`, stored now unless the same one already is. Inside the caller's transaction. */
  async snapshot(
    tx: SqlTransaction<typeof schema>,
    owner: Hero,
    build: BuildSnapshot,
    checked: CheckedNumbers,
  ): Promise<HeroBuild> {
    return (await this.store(tx, owner, build, checked)).build;
  }

  /** The hero's newest build (its highest revision), or undefined before the first. */
  async latest(
    heroId: string,
    tx: SqlTransaction<typeof schema> | Db = this.db,
  ): Promise<HeroBuild | undefined> {
    const [row] = await tx
      .select()
      .from(heroBuild)
      .where(eq(heroBuild.heroId, heroId))
      .orderBy(desc(heroBuild.revision), desc(heroBuild.createdAt))
      .limit(1);
    return row;
  }

  /** {@link snapshot}, saying whether this call stored the build (`created`) or found it stored. */
  async store(
    tx: SqlTransaction<typeof schema>,
    owner: Hero,
    build: BuildSnapshot,
    checked: CheckedNumbers,
  ): Promise<{ build: HeroBuild; created: boolean }> {
    const contentHash = buildHash(build);
    const [existing] = await tx
      .select()
      .from(heroBuild)
      .where(
        and(
          eq(heroBuild.heroId, owner.id),
          eq(heroBuild.revision, build.revision),
        ),
      )
      .limit(1);
    if (existing !== undefined) {
      if (existing.contentHash !== contentHash)
        throw new HttpError(HttpStatusCode.CONFLICT, 'BUILD_REVISION_TAKEN');
      return { build: existing, created: false };
    }
    const summary = { ...build.summary, ...checked.summary };
    const [row] = await tx
      .insert(heroBuild)
      .values({
        heroId: owner.id,
        revision: build.revision,
        gameVersion: build.gameVersion,
        level: build.level,
        ascendancy: build.ascendancy,
        dps: summary.dps,
        clearDps: summary.clearDps,
        ehp: summary.ehp,
        life: summary.life,
        energyShield: summary.energyShield,
        skills: build.skills,
        gear: build.gear,
        talents: build.talents,
        atlas: build.atlas,
        auras: build.auras,
        extras: build.extras,
        summary,
        card: checked.card ?? null,
        contentHash,
      })
      .onConflictDoNothing({ target: [heroBuild.heroId, heroBuild.revision] })
      .returning();
    if (row !== undefined) return { build: row, created: true };
    // The same revision arrived twice at once; the other one is stored.
    const [raced] = await tx
      .select()
      .from(heroBuild)
      .where(
        and(
          eq(heroBuild.heroId, owner.id),
          eq(heroBuild.revision, build.revision),
        ),
      )
      .limit(1);
    if (raced === undefined || raced.contentHash !== contentHash)
      throw new HttpError(HttpStatusCode.CONFLICT, 'BUILD_REVISION_TAKEN');
    return { build: raced, created: false };
  }

  /** The build card for `GET /api/builds/:id`. */
  async card(id: string): Promise<BuildCard> {
    const [row] = await this.db
      .select({
        build: heroBuild,
        hero,
        profile,
        image: user.image,
      })
      .from(heroBuild)
      .innerJoin(hero, eq(hero.id, heroBuild.heroId))
      .innerJoin(user, eq(user.id, hero.userId))
      .leftJoin(profile, eq(profile.userId, hero.userId))
      .where(eq(heroBuild.id, id))
      .limit(1);
    if (row === undefined)
      throw new HttpError(HttpStatusCode.NOT_FOUND, 'BUILD_NOT_FOUND');
    return {
      ...toBuildView(row.build),
      card: row.build.card,
      hero: toHeroView(row.hero),
      player:
        row.profile?.publicProfile === true
          ? {
              displayName: row.profile.displayName,
              avatar: avatarView(row.profile, row.image),
            }
          : null,
    };
  }
}
