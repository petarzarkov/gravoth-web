/**
 * Decision 229 (the developer: "use the bad-words npm package for chat and hero naming"): the one profanity filter, the
 * `bad-words` package's list, for chat messages, display names and hero names.
 *
 * A word counts only when it is one of the list's own entries, whole (any case), so a word that merely holds one passes
 * (the Scunthorpe problem: `Scunthorpe`, `assassin`, `classic`, `grape`, `therapist`, `Cockburn`). A word is a run of
 * letters and digits (so the list's `sh1t` and `a55` are words), and a run of letters inside one is checked too
 * (`shit2`, the `Fuck` of `Fuck_you`). A word spelled out letter by letter (`f u c k`, `f.u.c.k`, `f-u-c-k`, `f_u_c_k`)
 * counts as that word: the whole run of single letters, or four or more at its start or end (`u r a b i t c h`).
 *
 * Three words of its list are the game's own world and stay: `god`, `hell` and `damn` (the gods of the acts, a hell of a
 * fight).
 */
import { Filter } from 'bad-words';

export const ALLOWED_WORDS: readonly string[] = ['god', 'hell', 'damn'];

const filter = new Filter({ exclude: [...ALLOWED_WORDS] });

/** The list, lowercase: a word is profane only when it is one of these, whole. */
const WORDS: ReadonlySet<string> = new Set(
  filter.list
    .map((word) => word.toLowerCase())
    .filter((word) => !ALLOWED_WORDS.includes(word)),
);

/** A word: letters and digits. */
const TOKEN = /[\p{L}\p{N}]+/gu;
/** A run of letters inside a word. */
const LETTERS = /\p{L}+/gu;
/** One letter. */
const LETTER = /\p{L}/gu;

/**
 * Single letters, each on its own (no letter or digit touching it), with one to three separators between them: a
 * space, `.`, `-`, `_`, `*`, `+`, `~`, `|`, `/` or `\`. An apostrophe or a comma is not one (`I'm`, `a, b, c`).
 */
const SPELLED =
  /(?<![\p{L}\p{N}])\p{L}(?:[\s._\-*+~|/\\]{1,3}\p{L}(?![\p{L}\p{N}]))+/gu;

/**
 * A listed word spelled out inside a longer run counts at the run's start or end only, at least four letters long, with
 * at most three single letters beside it (`u r a b i t c h`, `what a d i c k`): a spelled-out word that only holds
 * one (`S C U N T H O R P E`, `C L A S S I C`) passes, as it does written whole.
 */
const SPELLED_INNER_MIN = 4;
const SPELLED_BESIDE_MAX = 3;

const stars = (word: string): string => '*'.repeat(Array.from(word).length);

/** Whether `word` is on the list (a whole entry, any case). */
export const isProfaneWord = (word: string): boolean =>
  word.length > 0 && WORDS.has(word.toLowerCase());

/** Which letters of a spelled-out run spell a listed word: all of them, or the longest one at its start or end. */
const spelledHits = (letters: readonly string[]): readonly number[] => {
  const word = (from: number, to: number) => letters.slice(from, to).join('');
  const all = (from: number, to: number) =>
    Array.from({ length: to - from }, (_, i) => from + i);
  const n = letters.length;
  if (isProfaneWord(word(0, n))) return all(0, n);
  for (
    let length = n - 1;
    length >= SPELLED_INNER_MIN && n - length <= SPELLED_BESIDE_MAX;
    length--
  ) {
    if (isProfaneWord(word(0, length))) return all(0, length);
    if (isProfaneWord(word(n - length, n))) return all(n - length, n);
  }
  return [];
};

/** The text with the letters of each spelled-out profane word masked, its separators kept (`f.u.c.k` is `*.*.*.*`). */
const maskSpelled = (text: string): string =>
  text.replace(SPELLED, (run) => {
    const letters = Array.from(run.matchAll(LETTER), (m) => ({
      at: m.index,
      length: m[0].length,
      letter: m[0],
    }));
    const hits = spelledHits(letters.map((l) => l.letter));
    if (hits.length === 0) return run;
    let masked = '';
    let from = 0;
    for (const hit of hits) {
      const letter = letters[hit];
      if (letter === undefined) continue;
      masked += `${run.slice(from, letter.at)}*`;
      from = letter.at + letter.length;
    }
    return masked + run.slice(from);
  });

/** The text with each profane word (or run of letters inside a word) masked, one `*` per character. */
const maskWords = (text: string): string =>
  text.replace(TOKEN, (token) =>
    isProfaneWord(token)
      ? stars(token)
      : token.replace(LETTERS, (run) =>
          isProfaneWord(run) ? stars(run) : run,
        ),
  );

/** A chat message with each profane word masked, one `*` per letter (`what the ****`, `* * * *`). */
export const maskProfanity = (text: string): string =>
  maskWords(maskSpelled(text));

/**
 * Whether a name (a display name or a hero's) holds a profane word: the whole name as the package reads it (its
 * phrases too), a word or a run of letters between `_`, `-`, spaces and digits, or a word spelled out letter by letter.
 */
export const isProfaneName = (name: string): boolean =>
  filter.isProfane(name) || maskProfanity(name) !== name;

/** A hero's name as others see it: its profane parts masked (a name made before a check, or on a phone that never asked). */
export const maskName = (name: string): string => maskProfanity(name);
