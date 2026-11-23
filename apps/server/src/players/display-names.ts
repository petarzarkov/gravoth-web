/**
 * Display names: what boards, friends and chat show. The format is the database's own check (`profiles_display_name_format`):
 * 3 to 20 letters, digits, `_` or `-`, starting with a letter or a digit. On top of it a name may not pose as the game or
 * its staff, nor hold a profane word: decision 229 (the developer: "use the bad-words npm package for chat and hero
 * naming") gives display names, hero names and chat one list, the `bad-words` package's (`profanity.ts`), each part of a
 * name between `_`, `-` and digits checked on its own.
 */
import { DISPLAY_NAME_PATTERN } from '@gravoth/contracts';
import { isProfaneName } from './profanity.js';

export { DISPLAY_NAME_PATTERN };

/** The start of a made-up name when the sign-in's own gives nothing usable. */
export const FALLBACK_NAME = 'Hero';

/** Posing as the game or its staff: anywhere in the name (any case, `_` and `-` ignored). Names only; chat may say "the dev". */
const STAFF_ANYWHERE: readonly string[] = [
  'gravoth',
  'admin',
  'moderator',
  'official',
];

/** The same, as a whole name or one of its parts (they are also parts of ordinary names: `mod` in `Modest`). */
const STAFF_WORDS: ReadonlySet<string> = new Set([
  'mod',
  'staff',
  'support',
  'system',
  'dev',
  'developer',
  'gm',
  'server',
  'null',
  'undefined',
]);

const posesAsStaff = (name: string): boolean => {
  const lower = name.toLowerCase();
  const joined = lower.replace(/[_-]/g, '');
  if (STAFF_ANYWHERE.some((word) => joined.includes(word))) return true;
  const parts = lower.split(/[_\-0-9]+/).filter((part) => part.length > 0);
  return [joined, joined.replace(/[0-9]+$/, ''), ...parts].some((word) =>
    STAFF_WORDS.has(word),
  );
};

export type NameProblem = 'format' | 'not-allowed';

/** Why a name may not be chosen, or undefined when it may. */
export const displayNameProblem = (name: string): NameProblem | undefined => {
  if (!DISPLAY_NAME_PATTERN.test(name)) return 'format';
  if (posesAsStaff(name) || isProfaneName(name)) return 'not-allowed';
  return undefined;
};

/**
 * The name a new account starts with, from the one its sign-in gave (`Sol`, a Google or Discord name, `Guest`): only
 * its letters and digits, at most 14 of them, or `Hero` when that leaves less than three or a refused word. The caller
 * adds digits until it is free.
 */
export const baseDisplayName = (name: string): string => {
  const letters = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 14);
  if (letters.length < 3) return FALLBACK_NAME;
  return displayNameProblem(letters) === undefined ? letters : FALLBACK_NAME;
};

/** `base` with `digits` random digits on the end (crypto randomness; nothing seeded or persisted depends on it). */
export const withDigits = (base: string, digits: number): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(digits));
  return base + [...bytes].map((b) => String(b % 10)).join('');
};
