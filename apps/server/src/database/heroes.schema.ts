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
 * A hero the server knows, owned by one user. An offline hero is registered by the game (by name, unique per player
 * among the offline ones, without regard to case) so its builds show on its player's page (decision 226: the game
 * sends every hero's build when it changes). An **online** hero (decision 227) is a hero of the account's realm
 * (`realms`), made and kept up to date by the rules checker's read of each upload and known by its id in that save
 * (`realm_character_id`, once per player); only online heroes stand on the boards, and a `flagged` one (the checker
 * found it implausible, `flag_note` says why) never does.
 *
 * `retired_at` (decision 226): the hero is gone from the phone (deleted, or moved), so its player page leaves it out;
 * its builds and board records stay. `POST /api/heroes/active` sets and clears it.
 *
 * `device_id` (decision 229): the phone that last registered or listed an offline hero (the game's install id), so a
 * phone's `active` retires only its own heroes and the unclaimed ones; null until a phone that sends its id claims it.
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
    /** Decision 227: an online hero's id in its realm's save (`CharacterSave.Id`); null for an offline hero. */
    realmCharacterId: integer('realm_character_id'),
    /** Decision 227: an online hero's level as the rules checker last read it. */
    level: smallint('level'),
    /** Decision 227: the rules checker found the hero implausible: kept for review, never on the boards. */
    flagged: boolean('flagged').notNull().default(false),
    flagNote: text('flag_note'),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    /** Decision 229: the phone holding an offline hero; null for an online hero and a hero no phone has claimed. */
    deviceId: text('device_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('heroes_id_user_key').on(t.id, t.userId),
    // One offline hero a name per player; online heroes are known by their realm's id (two may share a name).
    uniqueIndex('heroes_user_name_key')
      .on(t.userId, sql`lower(${t.name})`)
      .where(sql`NOT ${t.online}`),
    uniqueIndex('heroes_user_realm_character_key')
      .on(t.userId, t.realmCharacterId)
      .where(sql`${t.realmCharacterId} IS NOT NULL`),
    check(
      'heroes_realm_character',
      sql`${t.realmCharacterId} IS NULL OR (${t.online} AND ${t.realmCharacterId} >= 0)`,
    ),
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
