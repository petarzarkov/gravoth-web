import { ValidatorClient, type HeroSummary } from '../gravoth/validator.client.js';
import type { Hero, Leaderboard } from '../database/schema.js';
import type { BuildSnapshot } from '../heroes/build.schema.js';
import type { CheckedNumbers } from '../heroes/builds.service.js';

export interface BuildCheckInput {
  readonly board: Leaderboard;
  readonly hero: Hero;
  readonly score: number;
  readonly build: BuildSnapshot;
  /** The hero's save file, as the game writes it, for the rules checker to read. */
  readonly save?: string | undefined;
  /** The hero's id inside that save (`CharacterSave.Id`). */
  readonly saveHeroId?: number | undefined;
}

export interface BuildCheckResult extends CheckedNumbers {
  readonly verdict: 'pending' | 'verified' | 'flagged';
  readonly note: string | null;
}

/**
 * What decides whether a board score and its build are the hero's own: an interface (an abstract class, so it is a
 * token) the boards call, so the checker can change without the boards moving and a test can stand in for it.
 */
export abstract class BuildCheck {
  abstract check(input: BuildCheckInput): Promise<BuildCheckResult>;
}

/**
 * The rules checker's verdict (`dotnet/Gravoth.Validator`, decision 171): the game's own Core reads the hero's save
 * (`POST /saves/check`), so the server never re-implements the rules in TypeScript.
 *
 * - **verified:** the save reads, the hero is in it with this name, class and level, and the score is no higher than
 *   the save can back (today: the chart tier against `highestChartTier`). The build's DPS, clear DPS, EHP and life
 *   are the checker's own numbers, and its build card (`/saves/card`) is kept with the build.
 * - **pending:** no save came with the score, the checker is unreachable, or it needs a newer build of the game's
 *   rules than it has. The entry shows and is rechecked later.
 * - **flagged:** the save does not read, or it contradicts the claim. Kept for review, never shown (online-plan.md:
 *   "a failed check is flagged for review rather than deleted").
 *
 * TODO(step 4/5): the other boards' scores (Pit floor, Marks, the two times) are checked against the save once
 * Gravoth.Validator reports a hero's board records (`BoardRules` keeps them in the save); and a pending entry is
 * rechecked when its hero's save next reaches the server (online heroes, step 5).
 */
export class ValidatorBuildCheck extends BuildCheck {
  constructor(private readonly validator: ValidatorClient) {
    super();
  }

  async check(input: BuildCheckInput): Promise<BuildCheckResult> {
    if (input.save === undefined || input.saveHeroId === undefined) return { verdict: 'pending', note: 'no save came with the score' };
    let report;
    try {
      report = await this.validator.check(input.save);
    } catch {
      return { verdict: 'pending', note: 'the rules checker did not answer' };
    }
    if (!report.ok) {
      return report.needsNewerBuild
        ? { verdict: 'pending', note: 'the rules checker needs a newer build of the game' }
        : { verdict: 'flagged', note: 'the save does not read' };
    }
    const found = report.heroes.find((summary) => summary.id === input.saveHeroId);
    if (found === undefined) return { verdict: 'flagged', note: 'the hero is not in the save' };
    const mismatch = this.contradiction(input, found);
    if (mismatch !== undefined) return { verdict: 'flagged', note: mismatch };

    let card;
    try {
      card = (await this.validator.card(input.save, input.saveHeroId)) ?? undefined;
    } catch {
      card = undefined;
    }
    return {
      verdict: 'verified',
      note: null,
      summary: { dps: found.dps, clearDps: found.clearDps, ehp: found.ehp, life: Math.round(found.life) },
      card,
    };
  }

  private contradiction(input: BuildCheckInput, found: HeroSummary): string | undefined {
    if (found.name.trim().toLowerCase() !== input.hero.name.toLowerCase()) return `the save's hero is named ${found.name}`;
    if (found.class.toLowerCase() !== input.hero.class) return `the save's hero is a ${found.class}`;
    if (found.level !== input.build.level) return `the save's hero is level ${found.level}`;
    if (input.board.key === 'chart_tier' && input.score > found.highestChartTier) {
      return `the save's highest chart tier is ${found.highestChartTier}`;
    }
    return undefined;
  }
}
