import { z } from 'zod';

/** The game's classes, lower case (`Gravoth.Core`'s `HeroClass`). */
export const HERO_CLASSES = [
  'barbarian',
  'ranger',
  'sorcerer',
  'templar',
] as const;
export type HeroClass = (typeof HERO_CLASSES)[number];

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
