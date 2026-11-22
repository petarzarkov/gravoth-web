import { z } from 'zod';
import {
  HERO_CLASSES,
  MAX_ACTIVE_HEROES,
  type HeroClass,
} from './constants.js';
import { BuildSnapshot, type BuildView } from './build.js';

/** `POST /api/heroes`: a hero the server should know, by its name on this account. */
export const RegisterHero = z
  .object({
    name: z.string().trim().min(1).max(24),
    /** The game's class (`Barbarian` or `barbarian`). */
    class: z.preprocess(
      (value) => (typeof value === 'string' ? value.toLowerCase() : value),
      z.enum(HERO_CLASSES),
    ),
    hardcore: z.boolean().default(false),
  })
  .meta({
    id: 'RegisterHero',
    description: 'A hero the server should know, by its name on this account',
  });

export type RegisterHero = z.infer<typeof RegisterHero>;

export interface HeroView {
  readonly id: string;
  readonly name: string;
  readonly class: HeroClass;
  readonly hardcore: boolean;
  /** Decision 227: an online hero, whose save is the account's realm on the server; its records are the boards' only ones. */
  readonly online: boolean;
  readonly createdAt: string;
}

/** `GET /api/heroes`. */
export interface MyHeroes {
  readonly heroes: readonly HeroView[];
}

/** `POST /api/heroes`: `created` is false when the hero was already registered (after a reinstall, say). */
export interface RegisteredHero {
  readonly hero: HeroView;
  readonly created: boolean;
}

/**
 * `POST /api/heroes/:id/builds` (decision 226): the hero's build as it is now, sent by the game for every hero when it
 * changes, so a player page shows all of a player's heroes. `save` (the game's save, as a score's) or else the
 * account's cloud save gives the rules checker's build card for the hero `saveHeroId` in it.
 */
export const PostHeroBuild = z
  .object({
    build: BuildSnapshot,
    save: z.string().min(1).max(2_000_000).optional(),
    saveHeroId: z.number().int().min(0).optional(),
  })
  .meta({
    id: 'PostHeroBuild',
    description: "A hero's whole build as it is now, for its player page",
  });

export type PostHeroBuild = z.infer<typeof PostHeroBuild>;

/** `POST /api/heroes/:id/builds`: `created` is false when the build is the hero's latest already (that one is answered). */
export interface HeroBuildPosted {
  readonly build: BuildView;
  readonly created: boolean;
}

/**
 * `POST /api/heroes/active` (decision 226): the offline heroes still on the phone. The caller's other offline heroes
 * are retired (gone from the player page; their board records and builds stay), and the listed ones come back. An
 * online hero is its realm's: only the realm retires it (decision 227).
 */
export const ActiveHeroes = z
  .object({ heroIds: z.array(z.uuid()).max(MAX_ACTIVE_HEROES) })
  .meta({
    id: 'ActiveHeroes',
    description:
      'The offline heroes still on the phone; the others are retired',
  });

export type ActiveHeroes = z.infer<typeof ActiveHeroes>;

/** `POST /api/heroes/active`: how many heroes this call retired. */
export interface HeroesRetired {
  readonly retired: number;
}
