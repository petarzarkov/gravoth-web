import {
  ValidatorClient,
  type CardPage,
  type HeroCheck,
  type HeroesReport,
  type RecordCheck,
  type SaveReport,
} from '../gravoth/validator.client.js';

/**
 * The rules checker for the realm suites: a stand-in that reads a "save" written as JSON by the test, the heroes
 * `/saves/heroes` answers and the level each one's snapshot has (the real one reads the game's save with its Core; e2e/
 * drives that). `checker.down` makes it unreachable; `checker.snapshotsAsked` counts its snapshot reads.
 */
export const checker = { down: false, snapshotsAsked: 0 };

export class StandInValidator extends ValidatorClient {
  override async up(): Promise<boolean> {
    return true;
  }
  override async check(save: string): Promise<SaveReport> {
    return JSON.parse(save) as SaveReport;
  }
  override async heroes(save: string): Promise<HeroesReport> {
    if (checker.down) throw new Error('connection refused');
    if (save === 'garbage')
      return {
        ok: false,
        needsNewerBuild: false,
        needs: 0,
        warnings: ['unreadable'],
        saveId: null,
        heroes: [],
      };
    return {
      ok: true,
      needsNewerBuild: false,
      needs: 0,
      warnings: [],
      saveId: 'a1666a2c2290d9aa',
      heroes: (JSON.parse(save) as { heroes: HeroCheck[] }).heroes,
    };
  }
  override async snapshot(
    save: string,
    heroId: number,
    gameVersion: string,
  ): Promise<unknown> {
    checker.snapshotsAsked += 1;
    const found = (JSON.parse(save) as { heroes: HeroCheck[] }).heroes.find(
      (h) => h.characterId === heroId,
    );
    if (found === undefined) return null;
    return {
      revision: 0,
      gameVersion,
      level: found.level,
      skills: [{ id: 'cleave', level: 10, slot: 0, supports: [] }],
      gear: [],
      talents: { allocated: [1, 2] },
      extras: { border: 'pit_30' },
      summary: { dps: 10, clearDps: 5, ehp: 100, life: 50 },
    };
  }
  override async card(_save: string, heroId: number): Promise<CardPage[]> {
    return [
      {
        title: 'Build',
        sections: [
          { title: 'Hero', rows: [{ label: 'id', value: `${heroId}` }] },
        ],
      },
    ];
  }
}

export const record = (
  board: string,
  score: number,
  characterId: number,
  more: Partial<RecordCheck> = {},
): RecordCheck => ({
  board,
  score,
  characterId,
  witness: 'unchecked',
  plausible: true,
  ranked: true,
  ...more,
});

export const heroOf = (
  characterId: number,
  name: string,
  level: number,
  more: Partial<HeroCheck> = {},
): HeroCheck => ({
  characterId,
  name,
  class: 'barbarian',
  level,
  hardcore: false,
  plausible: true,
  reasons: [],
  records: [],
  fingerprint: `${characterId}${name}`
    .split('')
    .map((ch) => ch.charCodeAt(0).toString(16))
    .join('')
    .padEnd(64, '0')
    .slice(0, 64),
  dps: 1_234,
  clearDps: 900,
  ehp: 10_000,
  life: 3_000,
  highestChartTier: 0,
  ...more,
});

/** A realm's bytes: the stand-in's JSON, base64. */
export const realmOf = (...heroes: HeroCheck[]): string =>
  Buffer.from(JSON.stringify({ heroes })).toString('base64');
