/**
 * Decision 228's filter, run on every chat message before it is stored: links to anywhere but the website are refused
 * (`LINKS_NOT_ALLOWED`, a dodged dot read as a dot: `evil . com`, `evil dot com`, `evil(.)com`), and profane words are
 * masked with one `*` per letter by the `bad-words` package's list (decision 229, `players/profanity.ts`, the list
 * display names and hero names use too): whole words only, so `Scunthorpe` and `classic` pass, and a word spelled out
 * letter by letter (`f u c k`, `f.u.c.k`) counts as the word. Control and invisible characters go first, so a
 * zero-width space does not hide a word.
 */
import { CHAT_LIMITS, CHAT_LINK_HOST } from '@gravoth/contracts';
import { maskProfanity } from '../players/profanity.js';

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
 * A dot written to dodge the check: spaces on both sides (`evil . com`, `www . x . net`) or before it only (`evil .com`),
 * in brackets (`evil(.)com`, `evil [.] com`, `evil{.}com`), the word (`evil dot com`, `evil(dot)com`, `evil [dot] com`)
 * or an ideographic full stop (`evil。com`). Prose keeps its dots: a sentence's has a space after it only (`done. Club
 * tonight`).
 */
const DODGED_DOT =
  /\s*[[({<]\s*(?:\.|dot)\s*[\])}>]\s*|\s+(?:\.|dot)\s+|\s+\.(?=[a-z0-9])|[\u3002\uff61]/g;

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
  const tight = lower.replace(DODGED_DOT, '.');
  return foreignIn(lower) || (tight !== lower && foreignIn(tight));
};

/** The message as it is stored, or why it is refused. */
export const filterMessage = (raw: string): FilterOutcome => {
  const body = Array.from(visible(raw.normalize('NFKC')).trim())
    .slice(0, CHAT_LIMITS.MAX_BODY)
    .join('')
    .trim();
  if (body === '') return { ok: false, code: 'MESSAGE_NOT_ALLOWED' };
  if (hasForeignLink(body)) return { ok: false, code: 'LINKS_NOT_ALLOWED' };
  return { ok: true, body: maskProfanity(body) };
};
