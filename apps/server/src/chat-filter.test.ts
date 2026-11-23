import { describe, expect, it } from 'bun:test';
import { filterMessage, hasForeignLink } from './chat/chat-filter.js';
import { displayNameProblem } from './players/display-names.js';
import { isProfaneName, maskProfanity } from './players/profanity.js';

/**
 * The chat filter's tables (decision 228, the list of decision 229), both ways: what is masked or refused, and what
 * must pass untouched. Pure functions, no app; chat.test.ts drives the same filter over HTTP.
 */
const stored = (text: string): string => {
  const outcome = filterMessage(text);
  return outcome.ok ? outcome.body : outcome.code;
};

describe('profane words, whole', () => {
  it.each([
    ['what the fuck', 'what the ****'],
    ['FUCK this', '**** this'],
    ['Fuck_you', '****_you'],
    ['shit2', '****2'],
    ['sh1t happens', '**** happens'],
    ['you a55', 'you ***'],
    ['bitch, please', '*****, please'],
    ['motherfucker!', '************!'],
    ['the cock crowed', 'the **** crowed'],
    ["fuck's sake", "****'s sake"],
  ])('masks %p', (text, masked) => {
    expect(stored(text)).toBe(masked);
  });
});

describe('profane words spelled out letter by letter', () => {
  it.each([
    ['f u c k', '* * * *'],
    ['f.u.c.k', '*.*.*.*'],
    ['f-u-c-k', '*-*-*-*'],
    ['f_u_c_k off', '*_*_*_* off'],
    ['F U C K', '* * * *'],
    ['what the f u c k', 'what the * * * *'],
    ['what the f.u.c.k.', 'what the *.*.*.*.'],
    ['f . u . c . k', '* . * . * . *'],
    ['f  u  c  k', '*  *  *  *'],
    ['f*u*c*k', '*******'],
    ['s h i t', '* * * *'],
    ['b i t c h', '* * * * *'],
    ['c-u-n-t', '*-*-*-*'],
    ['a s s', '* * *'],
    ['a.s.s', '*.*.*'],
    ['a s s h o l e', '* * * * * * *'],
    ['u r a b i t c h', 'u r a * * * * *'],
    ['what a d i c k', 'what a * * * *'],
    ['f u c k y o u', '* * * * y o u'],
  ])('masks %p', (text, masked) => {
    expect(stored(text)).toBe(masked);
  });

  it.each([
    'C L A S S I C',
    'A S S A S S I N',
    'G R A P E',
    'S C U N T H O R P E',
    'C O C K B U R N',
    'C-O-C-K-T-A-I-L',
    'g g',
    'L O L',
    'i c u',
    'a b c d',
    'e.g. this',
    'i.e. that',
    'U.S.A. server',
    'a, s, s',
    "I'm a mess",
    'W A S S U P',
  ])('lets %p through', (text) => {
    expect(stored(text)).toBe(text);
  });
});

describe('words that only hold a listed word (the Scunthorpe problem)', () => {
  it.each([
    'Scunthorpe United',
    'Assassin build is great',
    'a classic run',
    'I love grape juice',
    'my therapist says hi',
    'Mr Cockburn joined',
    'cocktail of class and analysis',
    'the bass hits hard',
    'shitake mushrooms',
    'Dickens wrote it',
    'cumulative damage',
    'title and titan',
    'passive skills',
    'the God of the Pit, one hell of a fight, damn',
    'Long sword at lvl.70, v0.13.0',
  ])('lets %p through', (text) => {
    expect(stored(text)).toBe(text);
  });
});

describe('names (display names and heroes)', () => {
  it.each([
    'Fuck_you',
    'shit2',
    'f_u_c_k',
    'f-u-c-k',
    'F U C K',
    'x_s-h-i-t',
    'sh1t_lord',
    'Therapist_cunt',
  ])('refuses %p', (name) => {
    expect(isProfaneName(name)).toBe(true);
  });

  it.each([
    'Scunthorpe',
    'Assassin',
    'Classic',
    'Grapefruit',
    'TheTherapist',
    'Cockburn',
    'J-A-Y',
    'Kriso-the-Second',
  ])('lets %p through', (name) => {
    expect(isProfaneName(name)).toBe(false);
  });

  it('refuses a spelled-out display name', () => {
    expect(displayNameProblem('f_u_c_k')).toBe('not-allowed');
    expect(displayNameProblem('b-i-t-c-h')).toBe('not-allowed');
    expect(displayNameProblem('Scunthorpe_FC')).toBeUndefined();
  });

  it('masks a hero name the same way', () => {
    expect(maskProfanity('Big F U C K')).toBe('Big * * * *');
    expect(maskProfanity('Scunthorpe')).toBe('Scunthorpe');
  });
});

describe('links', () => {
  it.each([
    'evil.com',
    'evil . com',
    'evil .com',
    'evil dot com',
    'EVIL DOT COM',
    'evil (dot) com',
    'evil[dot]com',
    'evil(.)com',
    'evil [ . ] gg/abc',
    'evil{.}com',
    'evil<.>net',
    'evil。com',
    'www . x . net',
    'www dot x dot net',
    'see www.evil',
    'discord . gg / abc',
    'discord dot gg/abc',
    'join discord.gg/abc',
    'bit . ly/x',
    'https://evil.com',
    'mail me at a@gmail . com',
    'petarzarkov dot com',
    'gravoth.petarzarkov.com.evil.com',
    'gravoth . petarzarkov . com . evil . com',
  ])('refuses %p', (text) => {
    expect(hasForeignLink(text)).toBe(true);
    expect(stored(text)).toBe('LINKS_NOT_ALLOWED');
  });

  it.each([
    'https://gravoth.petarzarkov.com/builds/1f0c-aa',
    'gravoth.petarzarkov.com/players/1f0c',
    'gravoth . petarzarkov . com',
    'gravoth dot petarzarkov dot com',
    'done. Club tonight',
    'gg. win next time',
    'nice . me too',
    'wait... ok',
    'polka dot dress',
    'dot your i',
    'a dotted line',
    'connect dot to dot',
    'hello.world and i.am here',
    'e.g. Mr.Smith said ok.so',
    '1 .5 seconds',
  ])('lets %p through', (text) => {
    expect(hasForeignLink(text)).toBe(false);
    expect(stored(text)).toBe(text);
  });
});
