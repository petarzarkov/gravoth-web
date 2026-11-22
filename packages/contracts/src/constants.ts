/**
 * The plain facts the API and its clients share: no zod, so a browser bundle
 * that imports only these (`@gravoth/contracts/constants`) carries no schema
 * library. Everything here is also exported from `@gravoth/contracts`.
 */

/** The game's classes, lower case (`Gravoth.Core`'s `HeroClass`). */
export const HERO_CLASSES = [
  'barbarian',
  'ranger',
  'sorcerer',
  'templar',
] as const;
export type HeroClass = (typeof HERO_CLASSES)[number];

export const ITEM_SLOTS = [
  'MainHand',
  'OffHand',
  'Helm',
  'Chest',
  'Gloves',
  'Boots',
  'Belt',
  'Amulet',
  'Ring1',
  'Ring2',
] as const;
export type ItemSlot = (typeof ITEM_SLOTS)[number];

export const RARITIES = ['Normal', 'Magic', 'Rare', 'Unique'] as const;
export type Rarity = (typeof RARITIES)[number];

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

/** 3 to 20 letters, digits, `_` or `-`, starting with a letter or digit. The word filter is the server's. */
export const DISPLAY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/;
export const DISPLAY_NAME_RULE =
  '3 to 20 letters, digits, _ or -, starting with a letter or digit';

/** The third-party sign-ins, each offered only while the server has its client. */
export const SOCIAL_PROVIDERS = ['google', 'discord'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

/** A sign-in method a client can offer, as `GET /api/account/methods` lists it. */
export type SignInMethod = 'guest' | 'email' | SocialProvider;

/** better-auth's limits on a password (`emailAndPassword` in the server's auth module). */
export const PASSWORD_LIMITS = { min: 8, max: 128 } as const;

/** better-auth's routes, under `/api/auth`, that a browser client calls. */
export const AUTH_ROUTES = {
  session: '/api/auth/get-session',
  signInEmail: '/api/auth/sign-in/email',
  signUpEmail: '/api/auth/sign-up/email',
  signInSocial: '/api/auth/sign-in/social',
  signOut: '/api/auth/sign-out',
  requestPasswordReset: '/api/auth/request-password-reset',
  resetPassword: '/api/auth/reset-password',
  sendVerificationEmail: '/api/auth/send-verification-email',
} as const;

/**
 * The error codes the API answers with (the `message` of an error body), by
 * route. A client shows its own words for each; an unknown code is shown as
 * is.
 */
export const ERROR_CODES = [
  // Any route that needs a session.
  'UNAUTHENTICATED',
  'INVALID_CURSOR',
  // The account (POST /api/account/delete).
  'PASSWORD_REQUIRED',
  'INVALID_PASSWORD',
  // Profile (PATCH /api/profile).
  'NAME_FORMAT',
  'NAME_TAKEN',
  'NAME_NOT_ALLOWED',
  // Friends and blocks: a guest has neither.
  'GUEST_ACCOUNT',
  'PLAYER_NOT_FOUND',
  'CANNOT_FRIEND_SELF',
  'CANNOT_BLOCK_SELF',
  'ALREADY_FRIENDS',
  'ALREADY_REQUESTED',
  'PLAYER_BLOCKED',
  'REQUESTS_CLOSED',
  'REQUEST_NOT_FOUND',
  'FRIEND_NOT_FOUND',
  'BLOCK_NOT_FOUND',
  // Heroes and boards.
  'HERO_NAME_TAKEN',
  'HERO_NOT_FOUND',
  'BOARD_NOT_FOUND',
  'BUILD_NOT_FOUND',
  'BUILD_REVISION_TAKEN',
  'HARDCORE_MISMATCH',
  'SCORE_OUT_OF_RANGE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Keyset pagination as `@dunx/infra/pagination` answers it. The limits are
 * dunx's own (`PAGINATION`), repeated here so a browser bundle needs no server
 * package; `pagination.test.ts` keeps the two equal.
 */
export const PAGE_LIMITS = {
  MIN_TAKE: 1,
  MAX_TAKE: 100,
  DEFAULT_TAKE: 20,
  MAX_CURSOR: 512,
} as const;
