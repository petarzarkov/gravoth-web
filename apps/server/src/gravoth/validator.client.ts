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
      const res = await fetch(this.url('/health'), { signal: AbortSignal.timeout(1000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async check(save: string): Promise<SaveReport> {
    const res = await fetch(this.url('/saves/check'), { method: 'POST', body: save, headers: { 'content-type': 'text/plain' }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`validator /saves/check answered ${res.status}`);
    return (await res.json()) as SaveReport;
  }

  /** The hero's build card, or null when the save holds no such hero. */
  async card(save: string, heroId: number): Promise<CardPage[] | null> {
    const res = await fetch(this.url(`/saves/card/${heroId}`), { method: 'POST', body: save, headers: { 'content-type': 'text/plain' }, signal: AbortSignal.timeout(5000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`validator /saves/card answered ${res.status}`);
    return (await res.json()) as CardPage[];
  }
}
