import type { BoardFormat, HeroClass } from '@gravoth/contracts';

/** A board's score as the game shows it: a count, or a time (`4:07.250`, `1:02:03`). */
export const formatScore = (score: number, format: BoardFormat): string => {
  if (format === 'number') return score.toLocaleString('en-US');
  const totalMs = Math.max(0, Math.round(score));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  return `${minutes}:${ss}.${String(ms).padStart(3, '0')}`;
};

/** A big number short: `950`, `12.3k`, `4.56M`. */
export const formatCompact = (value: number): string => {
  const abs = Math.abs(value);
  if (abs < 1000) return String(Math.round(value));
  if (abs < 1_000_000) return `${trim(value / 1000)}k`;
  if (abs < 1_000_000_000) return `${trim(value / 1_000_000)}M`;
  return `${trim(value / 1_000_000_000)}B`;
};

const trim = (value: number): string => {
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  const fixed = value.toFixed(digits);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
};

export const CLASS_NAMES: Record<HeroClass, string> = {
  barbarian: 'Barbarian',
  ranger: 'Ranger',
  sorcerer: 'Sorcerer',
  templar: 'Templar',
};

export const formatDate = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
};

/** A day and a time: `22 Nov, 14:05`. */
export const formatDateTime = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
};

/** Play time as the game's choice card shows it: hours and minutes (`0:05`, `41:07`). */
export const formatPlayTime = (seconds: number): string => {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
};

/** A size in bytes: `512 B`, `12.3 KB`, `2.95 MB` (1 KB is 1,000 bytes). */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1000) return `${Math.max(0, Math.round(bytes))} B`;
  if (bytes < 999_500) return `${trim(bytes / 1000)} KB`;
  return `${trim(bytes / 1_000_000)} MB`;
};

const RELATIVE_STEPS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['minute', 60],
  ['hour', 3_600],
  ['day', 86_400],
  ['week', 604_800],
  ['month', 2_629_800],
  ['year', 31_557_600],
];

/** How long ago `iso` was: `just now`, `5 minutes ago`, `yesterday`, `3 months ago`. */
export const formatRelative = (iso: string, now = Date.now()): string => {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  const seconds = Math.max(0, (now - at) / 1000);
  if (seconds < 45) return 'just now';
  // The largest unit the time nearly fills (55 minutes reads as an hour).
  let [unit, size] = RELATIVE_STEPS[0] ?? ['minute', 60];
  for (const step of RELATIVE_STEPS)
    if (seconds >= step[1] * 0.9) [unit, size] = step;
  return new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' }).format(
    -Math.max(1, Math.round(seconds / size)),
    unit,
  );
};

/** A skill or support id the game sent without a name: `blade_vortex` reads `Blade Vortex`. */
export const titleOf = (id: string, name?: string): string =>
  name ??
  id
    .split(/[_:.-]+/)
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

/** The slot names the game's sheet uses. */
export const SLOT_NAMES: Record<string, string> = {
  MainHand: 'Main hand',
  OffHand: 'Off hand',
  Helm: 'Helm',
  Chest: 'Chest',
  Gloves: 'Gloves',
  Boots: 'Boots',
  Belt: 'Belt',
  Amulet: 'Amulet',
  Ring1: 'Ring',
  Ring2: 'Ring',
};

/** Keyed by the API's codes (`ErrorCode`) and better-auth's. */
const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'Sign in first.',
  NAME_FORMAT:
    'Names are 3 to 20 letters, digits, _ or -, starting with a letter or digit.',
  NAME_TAKEN: 'That name is taken.',
  NAME_NOT_ALLOWED: "That name isn't allowed.",
  NO_PROVIDER_PHOTO:
    'Your sign-in has no photo. Sign in with Google or Discord to use theirs.',
  GUEST_ACCOUNT:
    'Guest accounts have no friends list. Create an account first.',
  PLAYER_NOT_FOUND: 'No player has that name.',
  CANNOT_FRIEND_SELF: "That's you.",
  CANNOT_BLOCK_SELF: "That's you.",
  ALREADY_FRIENDS: "You're already friends.",
  ALREADY_REQUESTED: 'A request is already waiting.',
  PLAYER_BLOCKED: 'You blocked this player. Unblock them first.',
  REQUESTS_CLOSED: 'This player takes no friend requests.',
  REQUEST_NOT_FOUND: 'That request is gone.',
  FRIEND_NOT_FOUND: 'Not on your friends list.',
  BLOCK_NOT_FOUND: 'Not blocked.',
  PASSWORD_REQUIRED: 'Enter your password to delete the account.',
  INVALID_PASSWORD: 'Wrong password.',
  BOARD_NOT_FOUND: 'No such board.',
  BUILD_NOT_FOUND: 'No such build.',
  HERO_NOT_FOUND: 'No such hero.',
  // Chat moderation (the admin page).
  REPORT_NOT_FOUND: 'That report is gone.',
  MUTE_NOT_FOUND: 'That player is not muted.',
  MESSAGE_NOT_FOUND: 'That message is gone.',
  // better-auth's own codes.
  INVALID_EMAIL_OR_PASSWORD: 'Wrong email or password.',
  USER_ALREADY_EXISTS: 'An account already uses that email.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'An account already uses that email.',
  PASSWORD_TOO_SHORT: 'Passwords are at least 8 characters.',
  PASSWORD_TOO_LONG: 'Passwords are at most 128 characters.',
  INVALID_EMAIL: "That email doesn't look right.",
  TOO_MANY_REQUESTS: 'Too many tries. Wait a minute and try again.',
  HTTP_429: 'Too many tries. Wait a minute and try again.',
  // better-auth's, on the way back from Google or Discord (`/sign-in?error=`).
  account_not_linked:
    'An account already uses that email. Sign in to it with email and confirm the address, then this sign-in joins it.',
  access_denied: 'The sign-in was cancelled.',
  email_not_found:
    'That sign-in shared no email address, which an account needs.',
  unable_to_create_user: "The account couldn't be made. Try again.",
  please_restart_the_process: 'The sign-in took too long. Start it again.',
  state_mismatch: 'The sign-in took too long. Start it again.',
};

/** Words for an error code; an unknown one is shown as is. */
export const messageFor = (code: string): string => MESSAGES[code] ?? code;
