import { describe, expect, test } from 'bun:test';
import {
  AroundMe,
  BOARDS,
  BuildSnapshot,
  DISPLAY_NAME_PATTERN,
  HARDCORE_PREFIX,
  ReadBoard,
  RegisterHero,
  UpdateProfile,
  hardcoreTitle,
} from './index.js';

const build = {
  revision: 3,
  gameVersion: '0.12.0',
  level: 71,
  skills: [
    {
      id: 'cleave',
      level: 18,
      slot: 0,
      supports: [{ id: 'melee_phys', level: 15 }],
    },
  ],
  gear: [
    {
      slot: 'MainHand',
      name: 'Grief Cleaver',
      base: 'Great Axe',
      rarity: 'Rare',
      itemLevel: 70,
      lines: [{ text: '+42 to Strength', kind: 'suffix', tier: 2 }],
    },
  ],
  talents: { allocated: [1, 4, 9] },
  summary: { dps: 12_345.6, clearDps: 9_800, ehp: 31_000, life: 4_200 },
};

describe('BuildSnapshot', () => {
  test('fills the defaults a game build leaves out', () => {
    const parsed = BuildSnapshot.parse(build);
    expect(parsed.ascendancy).toBeNull();
    expect(parsed.auras).toEqual([]);
    expect(parsed.atlas).toEqual({});
    expect(parsed.summary.energyShield).toBe(0);
  });

  test('keeps extra numbers on the sheet', () => {
    const parsed = BuildSnapshot.parse({
      ...build,
      summary: { ...build.summary, attackSpeed: 1.7 },
    });
    expect(parsed.summary['attackSpeed']).toBe(1.7);
  });

  test('refuses an unknown slot, rarity or version', () => {
    const gear = build.gear[0];
    expect(
      BuildSnapshot.safeParse({ ...build, gear: [{ ...gear, slot: 'Tail' }] })
        .success,
    ).toBe(false);
    expect(
      BuildSnapshot.safeParse({
        ...build,
        gear: [{ ...gear, rarity: 'Legendary' }],
      }).success,
    ).toBe(false);
    expect(
      BuildSnapshot.safeParse({ ...build, gameVersion: 'latest' }).success,
    ).toBe(false);
  });

  test('bounds the free-form documents', () => {
    const huge = { blob: 'x'.repeat(40_000) };
    expect(BuildSnapshot.safeParse({ ...build, talents: huge }).success).toBe(
      false,
    );
  });
});

describe('boards', () => {
  test('keys are unique and fit the path rule, hardcore twin included', () => {
    const keys = BOARDS.map((board) => board.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(ReadBoard.shape).toBeDefined();
      expect(/^[a-z][a-z0-9_]{1,42}$/.test(`${HARDCORE_PREFIX}${key}`)).toBe(
        true,
      );
    }
  });

  test('a hardcore title reads as a sentence', () => {
    expect(hardcoreTitle('Deepest Bone Pit floor')).toBe(
      'Hardcore deepest Bone Pit floor',
    );
  });

  test('a board read pages forwards by default, the whole board, season 0', () => {
    const query = ReadBoard.parse({});
    expect(query).toMatchObject({
      take: 20,
      direction: 'forward',
      season: 0,
      view: 'all',
    });
    expect(ReadBoard.parse({ hardcore: 'true' }).hardcore).toBe(true);
    expect(AroundMe.parse({}).around).toBe(5);
    expect(ReadBoard.safeParse({ take: '500' }).success).toBe(false);
  });
});

describe('players', () => {
  test('display names: 3 to 20, starting with a letter or digit', () => {
    for (const ok of ['Ana', 'sol_99', '7th-son', 'A'.repeat(20)]) {
      expect(DISPLAY_NAME_PATTERN.test(ok)).toBe(true);
    }
    for (const bad of ['Al', '_ana', 'a b c', 'A'.repeat(21), 'émile']) {
      expect(DISPLAY_NAME_PATTERN.test(bad)).toBe(false);
    }
    expect(UpdateProfile.safeParse({ displayName: '-x-' }).success).toBe(false);
  });

  test('a hero class is read in any case', () => {
    expect(RegisterHero.parse({ name: 'Ash', class: 'Barbarian' }).class).toBe(
      'barbarian',
    );
    expect(
      RegisterHero.safeParse({ name: 'Ash', class: 'Necromancer' }).success,
    ).toBe(false);
  });
});
