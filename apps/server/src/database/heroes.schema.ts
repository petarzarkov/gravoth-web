import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  HERO_CLASSES,
  type Aura,
  type BuildDocument,
  type BuildSummary,
  type CardPage,
  type GearItem,
  type HeroClass,
  type SkillGem,
} from '@gravoth/contracts';
import { user } from './auth.schema.js';
import { jsonb } from './columns.js';

/** The game's four starting kits (`Gravoth.Core.Characters.ClassId`), lowercase. */
export { HERO_CLASSES, type HeroClass };

/**
 * A hero the server knows, owned by one user. An **online** hero (step 5) lives on the server and starts fresh; an
 * offline hero is registered only so its records can stand on the boards with their builds. An offline hero never
 * becomes an online one (decided 2026-11-22). The name is unique per player, without regard to case.
 *
 * `(id, user_id)` is unique so a board entry can name both and the database holds them together: an entry's player is
 * always its hero's owner, and a guest's heroes moving to the account it becomes carry their entries along.
 */
export const hero = pgTable(
  'heroes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    class: text('class', { enum: HERO_CLASSES }).notNull(),
    hardcore: boolean('hardcore').notNull().default(false),
    online: boolean('online').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('heroes_id_user_key').on(t.id, t.userId),
    uniqueIndex('heroes_user_name_key').on(t.userId, sql`lower(${t.name})`),
    check(
      'heroes_name_length',
      sql`char_length(${t.name}) BETWEEN 1 AND 24 AND ${t.name} = btrim(${t.name})`,
    ),
    check(
      'heroes_class',
      sql`${t.class} IN ('barbarian', 'ranger', 'sorcerer', 'templar')`,
    ),
  ],
);

/**
 * One immutable snapshot of a hero's whole build at a revision and a game version: what a board row opens as its
 * build card. A trigger (migration 0001) refuses every UPDATE; a new build is a new row with a higher revision.
 *
 * The parts whose shape is the game's are JSON (`skills` with their supports and levels, `gear` with every affix line,
 * `talents`, `atlas`, `auras`, `extras` for rites and cosmetics, `summary` for the computed sheet, `card` for the rules
 * checker's own build card); what the boards and the armory sort or filter by is a typed column beside them.
 */
export const heroBuild = pgTable(
  'hero_builds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    heroId: uuid('hero_id')
      .notNull()
      .references(() => hero.id, { onDelete: 'cascade' }),
    /** The hero's own build counter; each snapshot of one hero has its own. */
    revision: integer('revision').notNull(),
    gameVersion: text('game_version').notNull(),
    level: smallint('level').notNull(),
    ascendancy: text('ascendancy'),
    dps: doublePrecision('dps').notNull(),
    clearDps: doublePrecision('clear_dps').notNull(),
    ehp: doublePrecision('ehp').notNull(),
    life: integer('life').notNull(),
    energyShield: integer('energy_shield').notNull().default(0),
    skills: jsonb<SkillGem[]>('skills').notNull(),
    gear: jsonb<GearItem[]>('gear').notNull(),
    talents: jsonb<BuildDocument>('talents').notNull(),
    atlas: jsonb<BuildDocument>('atlas')
      .notNull()
      .default(sql`'{}'::jsonb`),
    auras: jsonb<Aura[]>('auras')
      .notNull()
      .default(sql`'[]'::jsonb`),
    extras: jsonb<BuildDocument>('extras')
      .notNull()
      .default(sql`'{}'::jsonb`),
    summary: jsonb<BuildSummary>('summary').notNull(),
    /** The rules checker's build card (`/saves/card`), when it read the hero's save. */
    card: jsonb<CardPage[]>('card'),
    /** SHA-256 of the build's content, so a resubmitted revision is recognised as the same build. */
    contentHash: text('content_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('hero_builds_hero_revision_key').on(t.heroId, t.revision),
    unique('hero_builds_id_hero_key').on(t.id, t.heroId),
    check('hero_builds_revision', sql`${t.revision} >= 0`),
    check('hero_builds_level', sql`${t.level} BETWEEN 1 AND 100`),
    check(
      'hero_builds_game_version',
      sql`${t.gameVersion} ~ '^[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,4}$'`,
    ),
    check(
      'hero_builds_numbers',
      sql`${t.dps} >= 0 AND ${t.clearDps} >= 0 AND ${t.ehp} >= 0 AND ${t.life} >= 0 AND ${t.energyShield} >= 0`,
    ),
    check(
      'hero_builds_json_shapes',
      sql`jsonb_typeof(${t.skills}) = 'array' AND jsonb_typeof(${t.gear}) = 'array' AND jsonb_typeof(${t.auras}) = 'array' AND jsonb_typeof(${t.summary}) = 'object'`,
    ),
    check('hero_builds_hash', sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
    // The armory's sorts.
    index('hero_builds_dps_idx').on(t.dps),
    index('hero_builds_ehp_idx').on(t.ehp),
    index('hero_builds_level_idx').on(t.level),
  ],
);

export type Hero = typeof hero.$inferSelect;
export type HeroBuild = typeof heroBuild.$inferSelect;
