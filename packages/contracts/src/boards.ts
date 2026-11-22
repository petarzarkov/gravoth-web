import { z } from 'zod';
import {
  HERO_CLASSES,
  type BoardFormat,
  type BoardSort,
  type HeroClass,
} from './constants.js';
import type { AvatarView } from './avatar.js';
import { BuildSnapshot, type BuildView } from './build.js';
import { PageQuery, type Page } from './pagination.js';

/** A board's key in a path: the game's own (`pit_floor`, `hc_pit_floor`). */
export const BoardKey = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,42}$/),
});

/** Which rows a board read covers. */
export const BoardScope = z.object({
  /** For a key without the `hc_` prefix: the hardcore twin. */
  hardcore: z.stringbool().optional(),
  season: z.coerce.number().int().min(0).default(0),
  /** `friends`: the caller and their friends only (needs a session). */
  view: z.enum(['all', 'friends']).default('all'),
  class: z.enum(HERO_CLASSES).optional(),
});

/** `GET /api/leaderboards`. */
export const ListBoards = z.object({
  hardcore: z.stringbool().optional(),
  season: z.coerce.number().int().min(0).optional(),
});

/** `GET /api/leaderboards/:key`. */
export const ReadBoard = PageQuery.extend(BoardScope.shape);

/** `GET /api/leaderboards/:key/me`. */
export const AroundMe = BoardScope.extend({
  around: z.coerce.number().int().min(0).max(25).default(5),
});

/** `POST /api/leaderboards/:key/scores`. */
export const SubmitScore = z
  .object({
    heroId: z.uuid(),
    score: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    /** When the hero set it; never later than the server's clock. Absent: now. */
    achievedAt: z.iso.datetime({ offset: true }).optional(),
    season: z.number().int().min(0).default(0),
    build: BuildSnapshot,
    /** The hero's save file as the game writes it, for the rules checker; without it the entry is `pending`. */
    save: z.string().min(1).max(2_000_000).optional(),
    /** The hero's id inside that save. */
    saveHeroId: z.number().int().min(0).optional(),
  })
  .meta({
    id: 'SubmitScore',
    description: "A hero's score on a board, with the whole build that set it",
  });

export type BoardScope = z.infer<typeof BoardScope>;
export type ListBoards = z.infer<typeof ListBoards>;
export type ReadBoard = z.infer<typeof ReadBoard>;
export type AroundMe = z.infer<typeof AroundMe>;
export type SubmitScore = z.infer<typeof SubmitScore>;

export interface BoardView {
  readonly key: string;
  readonly title: string;
  readonly hardcore: boolean;
  readonly season: number;
  /** `desc`: larger ranks higher. `asc`: smaller does. */
  readonly sort: BoardSort;
  readonly format: BoardFormat;
  readonly minScore: number;
  readonly maxScore: number;
}

/** `GET /api/leaderboards`. */
export interface BoardList {
  readonly boards: readonly BoardView[];
}

/** A shown entry's standing: `pending` until the rules checker has looked; a `flagged` entry is never shown. */
export type ShownVerdict = 'pending' | 'verified';
export type Verdict = ShownVerdict | 'flagged';

/** One row of a board: its place, the score, who set it, and the whole build that set it. */
export interface EntryView {
  /** 1 for the best, in the view asked for (the whole board, or the caller and their friends). */
  readonly rank: number;
  readonly id: string;
  readonly score: number;
  readonly achievedAt: string;
  readonly recordedAt: string;
  readonly verdict: ShownVerdict;
  /** A player whose profile is not public shows as hidden to everyone but themselves. */
  readonly player: {
    readonly userId: string | null;
    readonly displayName: string;
    /** Null for a hidden player, like their name. */
    readonly avatar: AvatarView | null;
    readonly hidden: boolean;
  };
  readonly hero: {
    readonly id: string;
    readonly name: string;
    readonly class: HeroClass;
    readonly hardcore: boolean;
  };
  readonly build: BuildView;
}

/** `GET /api/leaderboards/:key`. */
export interface BoardPage {
  readonly board: BoardView;
  readonly entries: Page<EntryView>;
}

/** `GET /api/leaderboards/:key/me`. */
export interface Neighbourhood {
  readonly board: BoardView;
  /** The caller's best hero on the board, or null when none of theirs is on it. */
  readonly entry: EntryView | null;
  /** Up to `around` rows above it, it, and up to `around` below, in board order. */
  readonly neighbours: readonly EntryView[];
}

/**
 * `POST /api/leaderboards/:key/scores`. `entry` is the hero's standing entry on the board after this submission;
 * `check` is how this submission itself was judged. A flagged submission never replaces a standing entry, and any
 * other submission replaces a flagged one.
 */
export interface SubmitResult {
  /** `new`: the hero's first score here. `improved`: it replaced the hero's entry. `kept`: the entry stands. */
  readonly result: 'new' | 'improved' | 'kept';
  readonly board: BoardView;
  readonly entry: {
    readonly id: string;
    readonly score: number;
    readonly buildId: string;
    readonly verdict: Verdict;
    readonly verdictNote: string | null;
    /** Null while flagged (a flagged entry is not shown). */
    readonly rank: number | null;
  };
  /** This submission's own verdict, and why when it was not verified. */
  readonly check: { readonly verdict: Verdict; readonly note: string | null };
}
