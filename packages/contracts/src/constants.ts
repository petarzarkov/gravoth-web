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

/**
 * The character portraits a player can pick (the game's NPC portrait atlas, `NpcLooks.PortraitIds`; append only, never
 * reorder). The website has each at `/img/portraits/<id>.webp`.
 */
export const AVATAR_PORTRAITS = [
  'warden',
  'quartermaster',
  'blacksmith',
  'sithgeek',
  'marto',
  'pip',
  'gambler',
  'debora',
  'brand',
  'wenna',
  'brute',
  'tamsin',
  'orrin',
  'brannoc',
  'wren',
  'odric',
  'hild',
  'mott',
  'signe',
  'pell',
  'quill',
  'keel',
  'tern',
  'kindle',
  'debora_freed',
  'gravelord',
  'first_cantor',
  'lucan',
  'maren',
  'ardith',
  'aveline',
  'wick',
  'warden_shade',
  'twice_sworn',
  'first_king',
  'the_chorus',
  'kings_herald',
  'rib_speaker',
  'kneeling_kingsguard',
  'swallowed_cantor',
  'ash_herald',
  'oathspeaker',
] as const;
export type AvatarPortrait = (typeof AVATAR_PORTRAITS)[number];

/**
 * The avatar borders a hero earns in the game (decision 196, `Gravoth.Core.Feats.AvatarBorders`), worst to best; a
 * build sends its hero's best as `extras.border`. The website has each frame at `/img/borders/<key>.webp`.
 */
export const AVATAR_BORDERS = [
  'pit_30',
  'tier_6',
  'hall_bronze',
  'trial_v',
  'pit_50',
  'tier_12',
  'hall_silver',
  'pit_75',
  'tier_16',
  'hall_gold',
  'hall_gold_4',
  'pinnacle',
  'pinnacle_gold',
] as const;
export type AvatarBorder = (typeof AVATAR_BORDERS)[number];

/** Each border's name and what earns it, as the game words them. */
export const AVATAR_BORDER_NAMES: Readonly<
  Record<AvatarBorder, { readonly name: string; readonly earned: string }>
> = {
  pit_30: { name: 'Delver', earned: 'Clear floor 30 of the Bone Pit' },
  tier_6: { name: 'Charter', earned: 'Clear a tier 6 chart' },
  hall_bronze: {
    name: 'Hall Bronze',
    earned: 'Clear a corner hall at tier 10+ in 4:30',
  },
  trial_v: { name: 'Trialborn', earned: 'Win Trial V' },
  pit_50: { name: "Pit's Floor", earned: 'Clear floor 50 of the Bone Pit' },
  tier_12: { name: 'Cartographer', earned: 'Clear a tier 12 chart' },
  hall_silver: {
    name: 'Hall Silver',
    earned: 'Clear a corner hall at tier 10+ in 3:00',
  },
  pit_75: { name: 'Abyssal', earned: 'Clear floor 75 of the Bone Pit' },
  tier_16: { name: 'Sealbreaker', earned: 'Clear a tier S16 chart' },
  hall_gold: {
    name: 'Hall Gold',
    earned: 'Clear a corner hall at tier 10+ in 2:00',
  },
  hall_gold_4: { name: 'Hallmaster', earned: 'Gold on all four corner halls' },
  pinnacle: { name: 'Voicebreaker', earned: 'Slay the First Voice' },
  pinnacle_gold: {
    name: 'Last Word',
    earned: 'Slay the First Voice in gold time',
  },
};

/** A build's border key when it is one the website knows; anything else (absent, a later game's) is none. */
export const avatarBorderOf = (value: unknown): AvatarBorder | null =>
  typeof value === 'string' &&
  (AVATAR_BORDERS as readonly string[]).includes(value)
    ? (value as AvatarBorder)
    : null;

/** Where a linked provider photo may load from (the site's img-src). */
export const AVATAR_IMAGE_SOURCES = [
  'https://*.googleusercontent.com',
  'https://cdn.discordapp.com',
] as const;

/**
 * The header the game sends on every call (`game/<version>`, decision 223): a session made for it lasts until the
 * player signs out of the game, where the website's cookie session lives 90 days, renewed by use.
 */
export const GAME_CLIENT_HEADER = 'x-gravoth-client';

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
/**
 * The largest cloud save the server keeps, in bytes of the decoded data: 3 MB, which is what the longest `data` a
 * `CloudSaveWrite` takes (4,000,000 base64 characters) decodes to. The game's own saves are a few tens of kilobytes.
 */
export const CLOUD_SAVE_MAX_BYTES = 3_000_000;

/** The longest `data` a `CloudSaveWrite` takes: the base64 of {@link CLOUD_SAVE_MAX_BYTES} bytes. */
export const CLOUD_SAVE_MAX_BASE64 = 4_000_000;

/** Decision 227: how long the realm's one-device lease lasts, renewed by every upload and every lease call. */
export const REALM_LEASE_SECONDS = 300;

/** Why the game uploads its realm: a checkpoint (an area change, a town visit, a floor done), the 2-minute interval, a pause or quit, a transfer, the first. */
export const REALM_REASONS = [
  'checkpoint',
  'interval',
  'pause',
  'transfer',
  'create',
] as const;
export type RealmReason = (typeof REALM_REASONS)[number];

/** Decision 226: the most heroes `POST /api/heroes/active` lists (a save holds six; room for later). */
export const MAX_ACTIVE_HEROES = 64;

/**
 * Decision 228: chat's limits, channels, report reasons and a report's outcomes (the shapes are chat.ts's).
 */
export const CHAT_LIMITS = {
  /** The longest message, after trimming. */
  MAX_BODY: 300,
  /** Messages a page holds by default, and at most. */
  DEFAULT_TAKE: 50,
  MAX_TAKE: 100,
  /** Messages a player may send in a minute, both channels together (then 429 `TOO_MANY_REQUESTS`). */
  SENDS_PER_MINUTE: 10,
  /** The same text as the sender's last message in that channel, within this many seconds, is refused (`CHAT_REPEAT`). */
  REPEAT_SECONDS: 30,
  /** Days a message is kept (one under an open report stays until the report is closed). */
  KEEP_DAYS: 30,
  /** Distinct players reporting one global message hide it until the developer looks. */
  AUTO_HIDE_REPORTS: 3,
  /** The longest mute, in hours (ten years: for good). */
  MAX_MUTE_HOURS: 87_600,
} as const;

/** The one site a chat message may link to (a build or a player page); any other link is `LINKS_NOT_ALLOWED`. */
export const CHAT_LINK_HOST = 'gravoth.petarzarkov.com';

export const CHAT_CHANNELS = ['global', 'direct'] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

export const REPORT_REASONS = [
  'spam',
  'harassment',
  'hate',
  'sexual',
  'cheating',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_ACTIONS = ['dismiss', 'hide', 'mute'] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

/** Decision 229: friend suggestions (`GET /api/friends/suggestions`; the shapes are social.ts's). */
export const SUGGESTION_LIMITS = {
  /** The most suggestions a list holds. */
  MAX: 20,
  /** Days a dismissed player stays out of the caller's suggestions. */
  DISMISS_DAYS: 30,
  /** Places above and below the caller's best on a board that count as near. */
  BOARD_PLACES: 5,
  /** Minutes either side of one of the caller's global messages that count as chatting together. */
  CHAT_MINUTES: 30,
  /** Days back the chat and the recently active players reach. */
  RECENT_DAYS: 7,
} as const;

export const ERROR_CODES = [
  // Any route that needs a session.
  'UNAUTHENTICATED',
  'INVALID_CURSOR',
  // The account (POST /api/account/delete).
  'PASSWORD_REQUIRED',
  'INVALID_PASSWORD',
  // The game's browser sign-in (/api/account/game-sign-in).
  'RETURN_NOT_ALLOWED',
  'CODE_INVALID',
  // Profile (PATCH /api/profile).
  'NAME_FORMAT',
  'NAME_TAKEN',
  'NAME_NOT_ALLOWED',
  'NO_PROVIDER_PHOTO',
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
  // The cloud save (/api/saves/me): a guest gets GUEST_ACCOUNT.
  'SAVE_TOO_LARGE',
  // An online hero's builds and records come from its realm only: its hero build and score routes answer HERO_ONLINE.
  'HERO_ONLINE',
  // The online realm (/api/realm, decision 227): a guest gets GUEST_ACCOUNT, a realm over 3 MB SAVE_TOO_LARGE.
  'REALM_LEASED',
  'LEASE_LOST',
  'REVISION_MISMATCH',
  'ALREADY_TRANSFERRED',
  'CHECKER_UNAVAILABLE',
  // Chat (/api/chat, decision 228): a guest gets GUEST_ACCOUNT. TOO_MANY_REQUESTS is a player's 11th message in a
  // minute (429, with Retry-After), counted per player in both channels, whatever their address.
  'TOO_MANY_REQUESTS',
  'CHAT_RULES',
  'CHAT_MUTED',
  'CHAT_REPEAT',
  'MESSAGE_NOT_ALLOWED',
  'LINKS_NOT_ALLOWED',
  'NOT_FRIENDS',
  'MESSAGE_NOT_FOUND',
  'CANNOT_REPORT_SELF',
  'REPORT_NOT_FOUND',
  'MUTE_NOT_FOUND',
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
