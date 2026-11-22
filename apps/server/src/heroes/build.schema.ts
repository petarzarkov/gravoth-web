import { z } from 'zod';

/**
 * A hero's full build as the game sends it with a board score: the shapes are the game's own (`Gravoth.Core`'s
 * `ItemSlot`, `Rarity` and the skill, support and aura ids), kept as JSON in `hero_builds`, with the numbers the boards
 * and the armory sort by lifted into columns. Bounded everywhere, so a snapshot is a few kilobytes, never megabytes.
 */
const key = z.string().min(1).max(64).regex(/^[A-Za-z0-9_:.-]+$/);
const label = z.string().min(1).max(80);
const count = (max: number) => z.number().int().min(0).max(max);

export const ITEM_SLOTS = ['MainHand', 'OffHand', 'Helm', 'Chest', 'Gloves', 'Boots', 'Belt', 'Amulet', 'Ring1', 'Ring2'] as const;
export const RARITIES = ['Normal', 'Magic', 'Rare', 'Unique'] as const;

/** One line on an item: an implicit, an affix with its tier, a unique's line, a corruption. */
export const AffixLine = z.object({
  text: z.string().min(1).max(160),
  kind: z.enum(['implicit', 'prefix', 'suffix', 'unique', 'crafted', 'corrupted', 'enchant']).optional(),
  tier: count(99).optional(),
  values: z.array(z.number().finite()).max(8).optional(),
});

export const GearItem = z.object({
  slot: z.enum(ITEM_SLOTS),
  name: label,
  base: label,
  rarity: z.enum(RARITIES),
  itemLevel: z.number().int().min(1).max(100),
  quality: count(40).optional(),
  sockets: count(6).optional(),
  corrupted: z.boolean().optional(),
  lines: z.array(AffixLine).max(40),
});

export const SupportGem = z.object({ id: key, name: label.optional(), level: z.number().int().min(1).max(40) });

export const SkillGem = z.object({
  id: key,
  name: label.optional(),
  level: z.number().int().min(1).max(40),
  quality: count(40).optional(),
  /** The skill bar's slot, when it is on the bar. */
  slot: count(15).optional(),
  supports: z.array(SupportGem).max(6),
});

export const Aura = z.object({ id: key, name: label.optional(), level: z.number().int().min(1).max(40), reservedPercent: z.number().min(0).max(100).optional() });

const resistances = z.object({
  fire: z.number().finite(),
  cold: z.number().finite(),
  lightning: z.number().finite(),
  chaos: z.number().finite(),
});

/** The computed sheet: what the game's character sheet (or the rules checker) works out. Extra numbers are kept. */
export const BuildSummary = z.looseObject({
  dps: z.number().finite().min(0),
  clearDps: z.number().finite().min(0),
  ehp: z.number().finite().min(0),
  life: z.number().int().min(0).max(10_000_000),
  energyShield: z.number().int().min(0).max(10_000_000).default(0),
  mana: z.number().int().min(0).optional(),
  armour: z.number().min(0).optional(),
  evasion: z.number().min(0).optional(),
  blockPercent: z.number().min(0).max(100).optional(),
  resistances: resistances.optional(),
});

/** Free-form JSON the game owns (the talent tree's allocations, the atlas), bounded by size. */
const document = z
  .record(z.string().max(64), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 32_768, 'at most 32 KB of JSON');

export const BuildSnapshot = z
  .object({
    /** The hero's own build counter: higher for a later build. */
    revision: z.number().int().min(0).max(2_147_483_647),
    gameVersion: z.string().regex(/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,4}$/),
    level: z.number().int().min(1).max(100),
    ascendancy: z.string().min(1).max(40).nullable().default(null),
    skills: z.array(SkillGem).max(24),
    gear: z.array(GearItem).max(24),
    talents: document,
    atlas: document.default({}),
    auras: z.array(Aura).max(12).default([]),
    /** Rites, cosmetics and whatever else the card shows. */
    extras: document.default({}),
    summary: BuildSummary,
  })
  .meta({ id: 'BuildSnapshot', description: "A hero's whole build at one revision: skills and supports, gear with every line, talents, atlas, auras, the computed sheet" });

export type BuildSnapshot = z.infer<typeof BuildSnapshot>;
export type GearItem = z.infer<typeof GearItem>;
export type SkillGem = z.infer<typeof SkillGem>;
export type Aura = z.infer<typeof Aura>;
export type BuildSummary = z.infer<typeof BuildSummary>;
export type BuildDocument = Record<string, unknown>;

/** The rules checker's build card (`dotnet/Gravoth.Validator`'s `CardPage`). */
export interface CardPage {
  title: string;
  sections: { title: string; rows: { label: string; value: string }[] }[];
}
