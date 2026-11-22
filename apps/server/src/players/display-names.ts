/**
 * Display names: what boards, friends and chat show. The format is the database's own check (`profiles_display_name_format`):
 * 3 to 20 letters, digits, `_` or `-`, starting with a letter or a digit. On top of it, a small word filter refuses
 * names that pose as staff or carry a slur or an obscenity; step 6's chat filter will grow from the same lists.
 *
 * Matching folds case and common look-alikes (`0` for `o`, `1` for `i`, `3`, `4`, `5`, `7`, `@`, `$`) and ignores `_`
 * and `-`, so `F_u_c_k` and `fvck` are not the way around it. Words that are also parts of ordinary words (`ass` in
 * `Assassin`, `rape` in `Grape`) are only refused as a whole word of the name.
 */
import { DISPLAY_NAME_PATTERN } from '@gravoth/contracts';

export { DISPLAY_NAME_PATTERN };

/** The start of a made-up name when the sign-in's own gives nothing usable. */
export const FALLBACK_NAME = 'Hero';

/** Refused anywhere in the name. */
const ANYWHERE = [
  'fuck', 'cunt', 'nigg', 'fagg', 'faggot', 'retard', 'hitler', 'whore', 'rapist', 'molest', 'kkk',
  // Posing as the game or its staff.
  'gravoth', 'admin', 'moderator', 'official',
];

/** Refused as a whole word: the name itself, or one of its parts split at `_`, `-` and digits. */
const WHOLE_WORDS = new Set([
  'shit', 'bitch', 'slut', 'cock', 'dick', 'pussy', 'porn', 'rape', 'fag', 'sex', 'ass', 'anal', 'penis', 'vagina', 'nazi', 'cum', 'tits',
  'mod', 'staff', 'support', 'system', 'dev', 'developer', 'gm', 'server', 'null', 'undefined',
]);

const LOOK_ALIKES: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', v: 'u' };

const fold = (text: string): string =>
  [...text.toLowerCase()].map((c) => LOOK_ALIKES[c] ?? c).join('');

export type NameProblem = 'format' | 'not-allowed';

/** Why a name may not be chosen, or undefined when it may. */
export const displayNameProblem = (name: string): NameProblem | undefined => {
  if (!DISPLAY_NAME_PATTERN.test(name)) return 'format';
  // Both spellings: folded (`fvck` is `fuck`) and as typed (folding `v` would hide `gravoth` as `grauoth`).
  const plain = name.replace(/[_-]/g, '').toLowerCase();
  const joined = fold(plain);
  if (ANYWHERE.some((word) => joined.includes(word) || plain.includes(word))) return 'not-allowed';
  // Whole words are checked before folding digits, so `Ana2` is the word `ana` and not `anaz`.
  const parts = name.toLowerCase().split(/[_\-0-9]+/).filter((part) => part.length > 0);
  const words = [...parts, ...parts.map(fold), plain, plain.replace(/[0-9]+$/, ''), joined, joined.replace(/[0-9]+$/, '')];
  if (words.some((word) => WHOLE_WORDS.has(word))) return 'not-allowed';
  return undefined;
};

/**
 * The name a new account starts with, from the one its sign-in gave (`Sol`, a Google or Discord name, `Guest`): only
 * its letters and digits, at most 14 of them, or `Hero` when that leaves less than three or a refused word. The caller
 * adds digits until it is free.
 */
export const baseDisplayName = (name: string): string => {
  const letters = name.normalize('NFKD').replace(/[^A-Za-z0-9]/g, '').slice(0, 14);
  if (letters.length < 3) return FALLBACK_NAME;
  return displayNameProblem(letters) === undefined ? letters : FALLBACK_NAME;
};

/** `base` with `digits` random digits on the end (crypto randomness; nothing seeded or persisted depends on it). */
export const withDigits = (base: string, digits: number): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(digits));
  return base + [...bytes].map((b) => String(b % 10)).join('');
};
