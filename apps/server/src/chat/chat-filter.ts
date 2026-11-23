/**
 * Decision 228's filter, run on every chat message before it is stored: links to anywhere but the website are refused
 * (`LINKS_NOT_ALLOWED`), slurs and hate are refused (`MESSAGE_NOT_ALLOWED`), and obscenities are masked with one `*`
 * per character. The words are the display names' lists (players/display-names.ts) with the same look-alike folding
 * (`0` for `o`, `fvck` for `fuck`), so a name and a message are held to the same words; the staff words are for names
 * only. Words that are also parts of ordinary words (`ass`, `rape`) count only whole, so `Assassin` and `grape` pass.
 */
import { CHAT_LIMITS, CHAT_LINK_HOST } from '@gravoth/contracts';
import {
  HATE_ANYWHERE,
  HATE_WORDS,
  OBSCENE_ANYWHERE,
  OBSCENE_WORDS,
  holdsAnywhere,
  wordForms,
} from '../players/display-names.js';

export type FilterOutcome =
  | { readonly ok: true; readonly body: string }
  | {
      readonly ok: false;
      readonly code: 'LINKS_NOT_ALLOWED' | 'MESSAGE_NOT_ALLOWED';
    };

/**
 * Control characters (a message is one line of plain text) become spaces; zero-width and direction marks go, since
 * they hide a word from the filter (`f`, a zero-width space, `uck`) or turn text around on screen. By code point:
 * soft hyphen, the combining grapheme joiner, Arabic's letter mark, the Hangul fillers, Khmer's and Mongolian's
 * invisible vowels and separator, the zero-width and direction marks, the word joiners and invisible operators, the
 * variation selectors and the byte order mark.
 */
const INVISIBLE: readonly (readonly [number, number])[] = [
  [0xad, 0xad],
  [0x34f, 0x34f],
  [0x61c, 0x61c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
];
const isControl = (code: number): boolean =>
  code <= 0x1f || (code >= 0x7f && code <= 0x9f);
const isInvisible = (code: number): boolean =>
  INVISIBLE.some(([from, to]) => code >= from && code <= to);

/** The text with control characters as spaces and invisible ones dropped. */
const visible = (text: string): string =>
  Array.from(text, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return isControl(code) ? ' ' : isInvisible(code) ? '' : character;
  }).join('');

/** Top-level domains that are a link wherever they end a dotted name (`evil.com`, `discord.gg`, `bit.ly`). */
const LINK_TLDS = new Set([
  'com',
  'net',
  'org',
  'io',
  'gg',
  'ly',
  'xyz',
  'ru',
  'de',
  'uk',
  'info',
  'biz',
  'app',
  'dev',
  'site',
  'online',
  'shop',
  'store',
  'link',
  'click',
  'top',
  'cc',
  'eu',
  'fr',
  'es',
  'nl',
  'pl',
  'br',
  'cn',
  'jp',
  'kr',
  'au',
  'ca',
  'ch',
  'se',
  'fi',
  'dk',
  'cz',
  'pt',
  'gr',
  'tk',
  'ml',
  'ga',
  'cf',
  'gq',
  'ws',
  'su',
  'ai',
  'sh',
  'fm',
  'tv',
  'live',
  'club',
  'win',
  'vip',
  'pro',
  'fun',
  'space',
  'website',
  'tech',
  'blog',
  'news',
  'cloud',
  'page',
  'icu',
  'buzz',
  'bet',
  'casino',
  'games',
  'gift',
  'gifts',
  'money',
  'cash',
  'trade',
  'market',
  'chat',
  'social',
  'stream',
  'video',
  'tube',
  'porn',
  'sex',
  'xxx',
  'onion',
  'ro',
  'ua',
  'by',
  'kz',
  'tr',
  'ir',
  'vn',
  'id',
  'ph',
  'mx',
  'ar',
  'cl',
  'za',
  'nz',
  'sg',
  'hk',
  'tw',
  'th',
  'my',
  'pk',
  'bd',
  'ng',
  'ke',
  'eg',
  'sa',
  'ae',
  'il',
  'hu',
  'sk',
  'si',
  'hr',
  'rs',
  'bg',
  'lt',
  'lv',
  'ee',
  'ie',
  'lu',
  'li',
  'mt',
  'cy',
  'gl',
  'gd',
  'vc',
  'ac',
  'pw',
]);

/**
 * Two-letter domains that are also short English words (`ok.so`, `i.am`, `yes.no`): a link only with a path, a port,
 * an address before it or `www.` (`evil.to/x`, `me@mail.co`), so ordinary typing without a space stays text.
 */
const WORD_TLDS = new Set([
  'to',
  'in',
  'it',
  'me',
  'so',
  'am',
  'at',
  'be',
  'us',
  'no',
  'is',
  'do',
  'go',
  'he',
  'we',
  'an',
  'as',
  'if',
  'of',
  'on',
  'up',
  'co',
  'tv',
  'im',
  'ad',
  'ma',
  'mu',
  'pe',
  'st',
  'la',
  'by',
  'my',
  'id',
]);

/** A dotted name, as a link or an address would hold one. */
const DOTTED =
  /(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}(?![a-z0-9-])/g;
/** `scheme://...`, with whatever follows up to a space. */
const SCHEMED = /[a-z][a-z0-9+.-]*:\/\/[^\s]*/g;
/** Link-like schemes with no `//` (`mailto:x@y`, `javascript:...`, a `data:` URI), not a word with a colon (`my data: 3`). */
const PSEUDO_SCHEME =
  /(?:^|[^a-z0-9])(?:(?:javascript|vbscript|mailto):\S|data:[a-z]+\/[a-z0-9.+-]+[;,])/;
/** `www.` starting a name: always a link (the website has none). */
const WWW = /(?:^|[^a-z0-9-])www\./;

/**
 * A dot written to dodge the check: spaces on both sides (`evil . com`) or in brackets (`evil(.)com`, `evil [.] com`).
 * Prose keeps its dots: a sentence's has a space after it only (`done. Club tonight`).
 */
const SPACED_DOT = /\s+\.\s+|\s*[[(]\s*\.\s*[\])]\s*/g;

const foreignIn = (lower: string): boolean => {
  if (PSEUDO_SCHEME.test(lower)) return true;
  for (const [link] of lower.matchAll(SCHEMED)) {
    const url = URL.parse(link);
    if (
      url === null ||
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.hostname !== CHAT_LINK_HOST ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== ''
    )
      return true;
  }
  if (WWW.test(lower)) return true;
  for (const match of lower.matchAll(DOTTED)) {
    const host = match[0];
    if (host === CHAT_LINK_HOST) continue;
    const tld = host.slice(host.lastIndexOf('.') + 1);
    if (LINK_TLDS.has(tld) && !WORD_TLDS.has(tld)) return true;
    if (WORD_TLDS.has(tld)) {
      const at = match.index;
      const before = lower[at - 1] ?? '';
      const after = lower[at + host.length] ?? '';
      if (before === '@' || before === '/' || after === '/' || after === ':')
        return true;
    }
  }
  return false;
};

/** Whether the text holds a link to anywhere but the website, its dodged dots read as dots. */
export const hasForeignLink = (text: string): boolean => {
  const lower = text.toLowerCase();
  const tight = lower.replace(SPACED_DOT, '.');
  return foreignIn(lower) || (tight !== lower && foreignIn(tight));
};

/**
 * A "word" for the filter: letters and digits with the symbols that stand in for letters or hide a word (`@`, `$`,
 * `!`, `|`, `.`, `*`, `'`, `_`, `-`). Everything else (spaces, `/`, `,`, `?`, brackets) separates words.
 */
const WORD = /[\p{L}\p{N}@$!|.*'’_-]+/gu;
const EDGES = /^[^\p{L}\p{N}@$]+|[^\p{L}\p{N}@$]+$/gu;

/** The spellings of a word to check: inner dots and quotes dropped (`f.u.c.k`), `!` and `|` read as `i`, and long runs of one letter shortened (`fuuuuck`). */
const spellings = (core: string): readonly string[] => {
  const joined = core.replace(/[.*'’]/g, '').replace(/[!|]/g, 'i');
  const squeezed = joined.replace(/(.)\1{2,}/gu, '$1');
  return squeezed === joined ? [joined] : [joined, squeezed];
};

const matchesAny = (
  spelled: readonly string[],
  anywhere: readonly string[],
  whole: ReadonlySet<string>,
): boolean =>
  spelled.some(
    (word) =>
      holdsAnywhere(word, anywhere) ||
      wordForms(word).some((form) => whole.has(form)),
  );

/** One `*` per character of the word, its surrounding punctuation kept (`shit!` becomes `****!`). */
const mask = (word: string, core: string): string =>
  word.replace(core, '*'.repeat(Array.from(core).length));

/** A word of one letter, digit or look-alike symbol. */
const SINGLE = /^[\p{L}\p{N}@$]$/u;

/** Three or more one-character words in a row, read as one (`f u c k`): the word, and where each character stands. */
interface SpacedRun {
  readonly joined: string;
  readonly at: readonly (readonly [number, number])[];
}

/**
 * Spaced-out letters: one-character words with only spaces and punctuation between them (`f u c k`, `s . h . i . t`).
 * A lone mark (`.`, `-`) between them does not end the run; any longer word does.
 */
const spacedRuns = (body: string): SpacedRun[] => {
  const runs: SpacedRun[] = [];
  let chars: string[] = [];
  let at: [number, number][] = [];
  const close = () => {
    if (chars.length >= 3) runs.push({ joined: chars.join(''), at });
    chars = [];
    at = [];
  };
  for (const match of body.matchAll(WORD)) {
    const word = match[0];
    const core = word.replace(EDGES, '');
    if (core === '') continue;
    if (!SINGLE.test(core)) {
      close();
      continue;
    }
    const start = match.index + word.indexOf(core);
    chars.push(core);
    at.push([start, start + core.length]);
  }
  close();
  return runs;
};

/** The message as it is stored, or why it is refused. */
export const filterMessage = (raw: string): FilterOutcome => {
  const body = Array.from(visible(raw.normalize('NFKC')).trim())
    .slice(0, CHAT_LIMITS.MAX_BODY)
    .join('')
    .trim();
  if (body === '') return { ok: false, code: 'MESSAGE_NOT_ALLOWED' };
  if (hasForeignLink(body)) return { ok: false, code: 'LINKS_NOT_ALLOWED' };
  // Spaced-out letters first: a hate word refuses the message, an obscenity masks each of its letters.
  let spaced = body;
  for (const run of spacedRuns(body).reverse()) {
    const spelled = spellings(run.joined);
    if (matchesAny(spelled, HATE_ANYWHERE, HATE_WORDS))
      return { ok: false, code: 'MESSAGE_NOT_ALLOWED' };
    if (!matchesAny(spelled, OBSCENE_ANYWHERE, OBSCENE_WORDS)) continue;
    for (const [from, to] of [...run.at].reverse())
      spaced = spaced.slice(0, from) + '*' + spaced.slice(to);
  }
  let refused = false;
  const masked = spaced.replace(WORD, (word) => {
    const core = word.replace(EDGES, '');
    if (core === '') return word;
    const spelled = spellings(core);
    if (matchesAny(spelled, HATE_ANYWHERE, HATE_WORDS)) {
      refused = true;
      return word;
    }
    return matchesAny(spelled, OBSCENE_ANYWHERE, OBSCENE_WORDS)
      ? mask(word, core)
      : word;
  });
  return refused
    ? { ok: false, code: 'MESSAGE_NOT_ALLOWED' }
    : { ok: true, body: masked };
};
