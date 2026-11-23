import { AppConfigService } from '../config.js';

/** One hero of a checked save, as dotnet/Gravoth.Validator's SaveCheck reports it. */
export interface HeroSummary {
  id: number;
  name: string;
  class: string;
  level: number;
  dps: number;
  clearDps: number;
  ehp: number;
  life: number;
  charts: number;
  highestChartTier: number;
}

export interface SaveReport {
  ok: boolean;
  needsNewerBuild: boolean;
  needs: number;
  warnings: string[];
  heroes: HeroSummary[];
}

/** One board record a save keeps, as `/saves/heroes` checks it (decision 227). */
export interface RecordCheck {
  board: string;
  score: number;
  characterId: number;
  /** `verified` (the checker's key says it is the game's), `unchecked` (it has no key), `invalid`. */
  witness: 'verified' | 'unchecked' | 'invalid';
  plausible: boolean;
  /** A board the boards show (every one but Trial V). */
  ranked: boolean;
}

/** One hero of a save, as `/saves/heroes` checks it (decision 227). */
export interface HeroCheck {
  characterId: number;
  name: string;
  /** The server's class key (`barbarian`). */
  class: string;
  /** Decision 230: the title the game shows; absent from a checker before it. */
  title?: string;
  /** Decision 230: the main talent path (`might` ... `minion`, or `` for a Wanderer); absent from a checker before it. */
  path?: string;
  level: number;
  hardcore: boolean;
  plausible: boolean;
  reasons: string[];
  records: RecordCheck[];
  /** The transfer fingerprint: SHA-256 hex of what identifies the hero in any save. */
  fingerprint: string;
  dps: number;
  clearDps: number;
  ehp: number;
  life: number;
  highestChartTier: number;
}

export interface HeroesReport {
  ok: boolean;
  needsNewerBuild: boolean;
  needs: number;
  warnings: string[];
  saveId: string | null;
  heroes: HeroCheck[];
}

export interface CardPage {
  title: string;
  sections: { title: string; rows: { label: string; value: string }[] }[];
}

/**
 * The API's way to the rules checker (decision 171): the game's own Core reads every save and prices every build, so the server
 * never re-implements the rules. Plain `fetch` with a timeout; a checker that is down is an error the caller turns into a 503.
 */
export class ValidatorClient {
  constructor(private readonly config: AppConfigService) {}

  private url(path: string): string {
    return new URL(path, this.config.get('validator').url).href;
  }

  async up(): Promise<boolean> {
    try {
      const res = await fetch(this.url('/health'), {
        signal: AbortSignal.timeout(1000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async check(save: string): Promise<SaveReport> {
    const res = await fetch(this.url('/saves/check'), {
      method: 'POST',
      body: save,
      headers: { 'content-type': 'text/plain' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok)
      throw new Error(`validator /saves/check answered ${res.status}`);
    return (await res.json()) as SaveReport;
  }

  /** Decision 227: every hero of a save (the realm), with its plausibility, records and fingerprint. */
  async heroes(save: string): Promise<HeroesReport> {
    const res = await fetch(this.url('/saves/heroes'), {
      method: 'POST',
      body: save,
      headers: { 'content-type': 'text/plain' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
      throw new Error(`validator /saves/heroes answered ${res.status}`);
    return (await res.json()) as HeroesReport;
  }

  /** Decision 227: Core's BuildSnapshotJson for one hero of a save (revision 0), or null when it holds no such hero. */
  async snapshot(
    save: string,
    heroId: number,
    gameVersion: string,
  ): Promise<unknown> {
    const url = new URL(this.url(`/saves/snapshot/${heroId}`));
    url.searchParams.set('gameVersion', gameVersion);
    const res = await fetch(url, {
      method: 'POST',
      body: save,
      headers: { 'content-type': 'text/plain' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return null;
    if (!res.ok)
      throw new Error(`validator /saves/snapshot answered ${res.status}`);
    return (await res.json()) as unknown;
  }

  /** The hero's build card, or null when the save holds no such hero. */
  async card(save: string, heroId: number): Promise<CardPage[] | null> {
    const res = await fetch(this.url(`/saves/card/${heroId}`), {
      method: 'POST',
      body: save,
      headers: { 'content-type': 'text/plain' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return null;
    if (!res.ok)
      throw new Error(`validator /saves/card answered ${res.status}`);
    return (await res.json()) as CardPage[];
  }
}
