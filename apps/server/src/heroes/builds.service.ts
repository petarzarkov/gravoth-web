import type { SqlTransaction } from '@dunx/infra/db';
import { HttpError, HttpStatusCode } from '@dunx/http';
import { and, eq } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { hero, heroBuild, profile, type Hero, type HeroBuild } from '../database/schema.js';
import type * as schema from '../database/schema.js';
import type { BuildSnapshot, BuildSummary, CardPage } from './build.schema.js';
import { toHeroView, type HeroView } from './heroes.service.js';

/** What the rules checker worked out for a build, laid over what the game sent. */
export interface CheckedNumbers {
  readonly summary?: Partial<Pick<BuildSummary, 'dps' | 'clearDps' | 'ehp' | 'life'>> | undefined;
  readonly card?: CardPage[] | undefined;
}

/** A build as a board row or a build card shows it. */
export interface BuildView {
  readonly id: string;
  readonly heroId: string;
  readonly revision: number;
  readonly gameVersion: string;
  readonly level: number;
  readonly ascendancy: string | null;
  readonly dps: number;
  readonly clearDps: number;
  readonly ehp: number;
  readonly life: number;
  readonly energyShield: number;
  readonly skills: HeroBuild['skills'];
  readonly gear: HeroBuild['gear'];
  readonly talents: HeroBuild['talents'];
  readonly atlas: HeroBuild['atlas'];
  readonly auras: HeroBuild['auras'];
  readonly extras: HeroBuild['extras'];
  readonly summary: HeroBuild['summary'];
  readonly createdAt: string;
}

/** The build card: the build, the rules checker's own card pages, the hero, and its player when the profile is public. */
export interface BuildCard extends BuildView {
  readonly card: CardPage[] | null;
  readonly hero: HeroView;
  readonly player: { readonly displayName: string } | null;
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

export const buildHash = (build: BuildSnapshot): string => new Bun.CryptoHasher('sha256').update(canonical(build)).digest('hex');

/**
 * Hero builds: immutable snapshots (a trigger refuses every UPDATE), one per hero and revision. Posting the same
 * build at a revision again finds the row it made; a different build at a revision already stored is refused, since
 * a board row must keep showing the build that set it.
 */
export class Builds {
  constructor(private readonly db: Db) {}

  /** The hero's build at `build.revision`, stored now unless the same one already is. Inside the caller's transaction. */
  async snapshot(tx: SqlTransaction<typeof schema>, owner: Hero, build: BuildSnapshot, checked: CheckedNumbers): Promise<HeroBuild> {
    const contentHash = buildHash(build);
    const [existing] = await tx
      .select()
      .from(heroBuild)
      .where(and(eq(heroBuild.heroId, owner.id), eq(heroBuild.revision, build.revision)))
      .limit(1);
    if (existing !== undefined) {
      if (existing.contentHash !== contentHash) throw new HttpError(HttpStatusCode.CONFLICT, 'BUILD_REVISION_TAKEN');
      return existing;
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
    if (row !== undefined) return row;
    // The same revision arrived twice at once; the other one is stored.
    const [raced] = await tx
      .select()
      .from(heroBuild)
      .where(and(eq(heroBuild.heroId, owner.id), eq(heroBuild.revision, build.revision)))
      .limit(1);
    if (raced === undefined || raced.contentHash !== contentHash) throw new HttpError(HttpStatusCode.CONFLICT, 'BUILD_REVISION_TAKEN');
    return raced;
  }

  /** The build card for `GET /api/builds/:id`. */
  async card(id: string): Promise<BuildCard> {
    const [row] = await this.db
      .select({ build: heroBuild, hero, displayName: profile.displayName, publicProfile: profile.publicProfile })
      .from(heroBuild)
      .innerJoin(hero, eq(hero.id, heroBuild.heroId))
      .leftJoin(profile, eq(profile.userId, hero.userId))
      .where(eq(heroBuild.id, id))
      .limit(1);
    if (row === undefined) throw new HttpError(HttpStatusCode.NOT_FOUND, 'BUILD_NOT_FOUND');
    return {
      ...toBuildView(row.build),
      card: row.build.card,
      hero: toHeroView(row.hero),
      player: row.publicProfile === true && row.displayName !== null ? { displayName: row.displayName } : null,
    };
  }
}
