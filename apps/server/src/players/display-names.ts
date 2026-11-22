/**
 * Display names: what boards, friends and chat show. The format is the database's own check (`profiles_display_name_format`):
 * 3 to 20 letters, digits, `_` or `-`, starting with a letter or a digit. On top of it, a small word filter refuses
 * names that pose as staff or carry a slur or an obscenity; chat's filter (decision 228) reads the same lists.
 *
 * Matching folds case and common look-alikes (`0` for `o`, `1` for `i`, `3`, `4`, `5`, `7`, `@`, `$`) and ignores `_`
 * and `-`, so `F_u_c_k` and `fvck` are not the way around it. Words that are also parts of ordinary words (`ass` in
 * `Assassin`, `rape` in `Grape`) are only refused as a whole word of the name.
 */
import { DISPLAY_NAME_PATTERN } from '@gravoth/contracts';

export { DISPLAY_NAME_PATTERN };

/** The start of a made-up name when the sign-in's own gives nothing usable. */
export const FALLBACK_NAME = 'Hero';

/**
 * The word lists, by kind, which chat's filter (chat/chat-filter.ts) reads too: a name refuses every kind, a chat message
 * refuses hate and masks obscenities, and the staff words are for names only (a player may say "the dev" in chat).
 *
 * `*_ANYWHERE` match inside a word; `*_WORDS` only as a whole word (or a part of a name split at `_`, `-` and digits),
 * because they are also parts of ordinary words (`ass` in `Assassin`, `rape` in `Grape`, `coon` in `Raccoon`).
 */
export const HATE_ANYWHERE: readonly string[] = [
  'nigg',
  'fagg',
  'faggot',
  'retard',
  'hitler',
  'rapist',
  'molest',
  'kkk',
  'kike',
  'wetback',
  'tranny',
  'pedophil',
  'paedophil',
];

export const OBSCENE_ANYWHERE: readonly string[] = [
  'fuck',
  'cunt',
  'whore',
  'motherf',
  'blowjob',
  'dildo',
];

const STAFF_ANYWHERE: readonly string[] = [
  // Posing as the game or its staff.
  'gravoth',
  'admin',
  'moderator',
  'official',
];

export const HATE_WORDS: ReadonlySet<string> = new Set([
  'rape',
  'raped',
  'raping',
  'fag',
  'fags',
  'nazi',
  'nazis',
  'spic',
  'gook',
  'chink',
  'coon',
  'beaner',
  'paki',
]);

export const OBSCENE_WORDS: ReadonlySet<string> = new Set([
  'shit',
  'shitty',
  'bullshit',
  'bitch',
  'bitches',
  'slut',
  'cock',
  'dick',
  'dicks',
  'pussy',
  'porn',
  'sex',
  'ass',
  'asshole',
  'arse',
  'anal',
  'penis',
  'vagina',
  'cum',
  'tits',
  'twat',
  'wank',
  'wanker',
  'bollocks',
]);

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

/** Refused anywhere in the name. */
const ANYWHERE = [...HATE_ANYWHERE, ...OBSCENE_ANYWHERE, ...STAFF_ANYWHERE];

/** Refused as a whole word: the name itself, or one of its parts split at `_`, `-` and digits. */
const WHOLE_WORDS = new Set([...HATE_WORDS, ...OBSCENE_WORDS, ...STAFF_WORDS]);

const LOOK_ALIKES: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  v: 'u',
};

/** Lower case with the look-alikes folded (`F4ck` is `fack`, `fvck` is `fuck`). */
export const fold = (text: string): string =>
  Array.from(text.toLowerCase(), (c) => LOOK_ALIKES[c] ?? c).join('');

/**
 * The spellings of one word to match whole: its parts split at `_`, `-` and digits (before folding, so `Ana2` is the
 * word `ana` and not `anaz`), the parts folded, and the whole word plain and folded, each with and without trailing
 * digits.
 */
export const wordForms = (word: string): readonly string[] => {
  const plain = word.replace(/[_-]/g, '').toLowerCase();
  const joined = fold(plain);
  const parts = word
    .toLowerCase()
    .split(/[_\-0-9]+/)
    .filter((part) => part.length > 0);
  return [
    ...parts,
    ...parts.map(fold),
    plain,
    plain.replace(/[0-9]+$/, ''),
    joined,
    joined.replace(/[0-9]+$/, ''),
  ];
};

/** Whether `word` holds one of `anywhere` inside it, folded (`fvck` is `fuck`) or as typed (folding `v` would hide `gravoth` as `grauoth`). */
export const holdsAnywhere = (
  word: string,
  anywhere: readonly string[],
): boolean => {
  const plain = word.replace(/[_-]/g, '').toLowerCase();
  const joined = fold(plain);
  return anywhere.some((bad) => joined.includes(bad) || plain.includes(bad));
};

export type NameProblem = 'format' | 'not-allowed';

/** Why a name may not be chosen, or undefined when it may. */
export const displayNameProblem = (name: string): NameProblem | undefined => {
  if (!DISPLAY_NAME_PATTERN.test(name)) return 'format';
  if (holdsAnywhere(name, ANYWHERE)) return 'not-allowed';
  if (wordForms(name).some((word) => WHOLE_WORDS.has(word)))
    return 'not-allowed';
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
