import { z } from 'zod';
import { BuildSnapshot, type BuildView } from './build.js';
import { HERO_CLASSES, type HeroClass } from './heroes.js';
import { PageQuery, type Page } from './pagination.js';

export type BoardSort = 'asc' | 'desc';
export type BoardFormat = 'number' | 'time_ms';

export interface BoardDefinition {
  readonly key: string;
  readonly title: string;
  readonly sort: BoardSort;
  readonly format: BoardFormat;
  readonly minScore: number;
  readonly maxScore: number;
}

/** The hardcore twin's prefix on the game's keys (`hc_pit_floor`, `Gravoth.Core.Feats.Boards.HardcorePrefix`). */
export const HARDCORE_PREFIX = 'hc_';

/**
 * The boards, from the game's own definitions (`Gravoth.Core.Feats.Boards`:
 * keys, names, orders and limits), each with a hardcore twin, all in season 0,
 * the permanent one. A new board or season is a line here; a published board's
 * order and format never change.
 */
export const BOARDS: readonly BoardDefinition[] = [
  {
    key: 'pit_floor',
    title: 'Deepest Bone Pit floor',
    sort: 'desc',
    format: 'number',
    minScore: 1,
    maxScore: 9_999,
  },
  {
    key: 'chart_tier',
    title: 'Highest chart tier',
    sort: 'desc',
    format: 'number',
    minScore: 1,
    maxScore: 16,
  },
  {
    key: 'map_s16',
    title: 'Fastest S16 map clear',
    sort: 'asc',
    format: 'time_ms',
    minScore: 1,
    maxScore: 86_400_000,
  },
  {
    key: 'marks',
    title: 'Most Marks',
    sort: 'desc',
    format: 'number',
    minScore: 1,
    maxScore: 99_999,
  },
  {
    key: 'first_voice',
    title: 'Fastest First Voice kill',
    sort: 'asc',
    format: 'time_ms',
    minScore: 30_000,
    maxScore: 86_400_000,
  },
];

/** "Hardcore deepest Bone Pit floor". */
export const hardcoreTitle = (title: string): string =>
  `Hardcore ${title.charAt(0).toLowerCase()}${title.slice(1)}`;

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

/** `POST /api/leaderboards/:key/scores`. */
export interface SubmitResult {
  /** `new`: the hero's first score here. `improved`: it beat the hero's best. `kept`: the best stands. */
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
}
