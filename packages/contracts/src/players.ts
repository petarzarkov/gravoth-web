import type { AvatarView } from './avatar.js';
import type { BuildView } from './build.js';
import type { HeroView } from './heroes.js';

/**
 * A player page (decision 226, `GET /api/players/:userId`): all of a player's heroes, each with its newest build and
 * the records it holds, so friends (and anyone, unless the profile is hidden) see them as the boards show them.
 */

/** One record a hero holds: the board's key as the game names it (`hc_pit_floor` for a hardcore board), and its rank there. */
export interface PlayerRecord {
  readonly board: string;
  readonly score: number;
  readonly rank: number;
}

export interface PlayerHero {
  readonly hero: HeroView;
  /** The hero's newest build (as a board row carries it), or null before the game sent one. */
  readonly build: BuildView | null;
  readonly records: readonly PlayerRecord[];
}

/** `GET /api/players/:userId`: 404 `PLAYER_NOT_FOUND` for a hidden player to anyone but a friend and themselves. */
export interface PlayerPage {
  readonly player: {
    readonly userId: string;
    readonly displayName: string;
    readonly avatar: AvatarView;
    /** The profile is hidden: only friends (and the player) see this page. */
    readonly hidden: boolean;
  };
  /** Heroes not retired, the newest build's level first, then by name. */
  readonly heroes: readonly PlayerHero[];
}
