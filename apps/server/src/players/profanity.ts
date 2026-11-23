/**
 * Decision 229 (the developer: "use the bad-words npm package for chat and hero naming"): the one profanity filter, the
 * `bad-words` package's list, for chat messages, display names and hero names. It matches whole words (so `Scunthorpe`,
 * `Assassin` and `grape` pass) without look-alike folding.
 *
 * Three words of its list are the game's own world and stay: `god`, `hell` and `damn` (the gods of the acts, a hell of a
 * fight).
 */
import { Filter } from 'bad-words';

export const ALLOWED_WORDS: readonly string[] = ['god', 'hell', 'damn'];

const filter = new Filter({ exclude: [...ALLOWED_WORDS] });

/** A run of letters: a name's parts are checked one by one, so `_` and digits do not hide a word (`Fuck_you`, `shit2`). */
const LETTERS = /\p{L}+/gu;

/** Whether `word` is on the list (a whole word, any case). */
export const isProfaneWord = (word: string): boolean =>
  word.length > 0 && filter.isProfane(word);

/** A chat message with each profane word masked, one `*` per letter (`what the ****`). */
export const maskProfanity = (text: string): string =>
  text.replace(LETTERS, (word) =>
    isProfaneWord(word) ? '*'.repeat(Array.from(word).length) : word,
  );

/** Whether a name (a display name or a hero's) holds a profane word, whole or as a part between `_`, `-`, spaces and digits. */
export const isProfaneName = (name: string): boolean =>
  isProfaneWord(name) ||
  Array.from(name.matchAll(LETTERS), (m) => m[0]).some(isProfaneWord);

/** A hero's name as others see it: its profane parts masked (a name made before a check, or on a phone that never asked). */
export const maskName = (name: string): string => maskProfanity(name);
