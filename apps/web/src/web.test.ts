import { describe, expect, test } from 'bun:test';
import { AVATAR_BORDERS, AVATAR_PORTRAITS } from '@gravoth/contracts/constants';
import { Glob } from 'bun';
import { errorCode, withQuery } from './api.js';
import { buildFacts } from './build-facts.js';
import {
  BORDER_HOLE_ON_PICTURE,
  BORDER_HOLE_SHARE,
  borderSrc,
  borderWidth,
  portraitSrc,
} from './components/avatar.js';
import {
  formatBytes,
  formatCompact,
  formatPlayTime,
  formatRelative,
  formatScore,
  messageFor,
  titleOf,
} from './format.js';
import { matchPath } from './router.js';
import { safeNext } from './pages/sign-in.js';
import { bestBorder, recordBoard } from './pages/player.js';

describe('format', () => {
  test('a count board reads as a number', () => {
    expect(formatScore(1234, 'number')).toBe('1,234');
  });

  test('a time board reads as the game shows it', () => {
    expect(formatScore(247_250, 'time_ms')).toBe('4:07.250');
    expect(formatScore(3_723_000, 'time_ms')).toBe('1:02:03');
    expect(formatScore(59_999, 'time_ms')).toBe('0:59.999');
  });

  test('big numbers go short', () => {
    expect(formatCompact(950)).toBe('950');
    expect(formatCompact(12_345)).toBe('12.3k');
    expect(formatCompact(4_560_000)).toBe('4.56M');
    expect(formatCompact(100_000)).toBe('100k');
  });

  test("a cloud save's play time reads in hours and minutes", () => {
    expect(formatPlayTime(0)).toBe('0:00');
    expect(formatPlayTime(59)).toBe('0:00');
    expect(formatPlayTime(3_725)).toBe('1:02');
    expect(formatPlayTime(148_020)).toBe('41:07');
  });

  test('a size reads in B, KB or MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(12_345)).toBe('12.3 KB');
    expect(formatBytes(999_999)).toBe('1 MB');
    expect(formatBytes(3_000_000)).toBe('3 MB');
  });

  test('a time reads as how long ago it was', () => {
    const now = Date.parse('2026-11-22T12:00:00Z');
    const ago = (seconds: number) =>
      formatRelative(new Date(now - seconds * 1000).toISOString(), now);
    expect(ago(10)).toBe('just now');
    expect(ago(300)).toBe('5 minutes ago');
    expect(ago(3_300)).toBe('1 hour ago');
    expect(ago(86_400)).toBe('yesterday');
    expect(ago(3 * 86_400)).toBe('3 days ago');
    expect(ago(70 * 86_400)).toBe('2 months ago');
    expect(formatRelative('not a time', now)).toBe('not a time');
  });

  test('an id without a name reads as words', () => {
    expect(titleOf('blade_vortex')).toBe('Blade Vortex');
    expect(titleOf('x', 'Given')).toBe('Given');
  });

  test('a code has words; an unknown one shows as is', () => {
    expect(messageFor('NAME_TAKEN')).toBe('That name is taken.');
    expect(messageFor('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});

describe('api', () => {
  test('the code comes from either error shape', () => {
    expect(errorCode(409, { error: 'NAME_TAKEN', status: 409 })).toBe(
      'NAME_TAKEN',
    );
    expect(errorCode(400, { message: 'Bad input' })).toBe('Bad input');
    expect(
      errorCode(401, {
        code: 'INVALID_EMAIL_OR_PASSWORD',
        message: 'Invalid email or password',
      }),
    ).toBe('INVALID_EMAIL_OR_PASSWORD');
    expect(errorCode(502, null)).toBe('HTTP_502');
  });

  test('a query leaves out what is unset', () => {
    expect(
      withQuery('/api/leaderboards/marks', {
        hardcore: true,
        class: undefined,
        take: 3,
        cursor: '',
      }),
    ).toBe('/api/leaderboards/marks?hardcore=true&take=3');
    expect(withQuery('/x')).toBe('/x');
  });
});

describe('router', () => {
  test('patterns match one segment per param', () => {
    expect(matchPath('/boards/:key', '/boards/pit_floor')).toEqual({
      key: 'pit_floor',
    });
    expect(matchPath('/boards/:key', '/boards/pit_floor/extra')).toBeNull();
    expect(matchPath('/', '/')).toEqual({});
    expect(matchPath('/builds/:id', '/builds/%E2%9C%93')).toEqual({ id: '✓' });
    expect(matchPath('/builds/:id', '/builds/%E0%A4%A')).toBeNull();
  });

  test('after sign-in only a path on this site is followed', () => {
    expect(safeNext('/friends')).toBe('/friends');
    expect(safeNext('//evil.example')).toBe('/account');
    expect(safeNext('https://evil.example')).toBe('/account');
    expect(safeNext(null)).toBe('/account');
  });
});

describe('pictures', () => {
  test('every portrait a player can pick has its image, and no other image is there', async () => {
    const files = [
      ...new Glob('*.webp').scanSync({
        cwd: `${import.meta.dir}/../public/img/portraits`,
      }),
    ].sort();
    expect(files).toEqual(AVATAR_PORTRAITS.map((id) => `${id}.webp`).sort());
    expect(portraitSrc('gravelord')).toBe('/img/portraits/gravelord.webp');
  });

  test('a missing photo says how to get one', () => {
    expect(messageFor('NO_PROVIDER_PHOTO')).toContain('Google or Discord');
  });
});

describe('avatar borders', () => {
  test('every border the game sends has its frame, and no other frame is there', async () => {
    const files = [
      ...new Glob('*.webp').scanSync({
        cwd: `${import.meta.dir}/../public/img/borders`,
      }),
    ].sort();
    expect(files).toEqual(AVATAR_BORDERS.map((key) => `${key}.webp`).sort());
    expect(borderSrc('hall_gold_4')).toBe('/img/borders/hall_gold_4.webp');
  });

  test('a frame is sized as the game sizes it: its hole, 56% of its width, is 96% of the picture', () => {
    expect(BORDER_HOLE_SHARE).toBe(0.56);
    expect(BORDER_HOLE_ON_PICTURE).toBe(0.96);
    expect(borderWidth(56)).toBe(96);
    expect(borderWidth(30)).toBe(51);
  });
});

describe('build facts', () => {
  test("read the game's documents: talents, carvings, Marks, attributes, rites, atlas, border, cosmetics", () => {
    const sections = buildFacts({
      talents: { version: 3, points: 41, earned: 45, nodes: [1, 4, 9] },
      atlas: { tree: [0, 2], highestTier: 12, cleared: 9, chartsRun: 140 },
      extras: {
        tag: 'x',
        marks: 120,
        overlevels: 2,
        mainSkill: 'cleave',
        movement: 'leap_slam',
        rites: [
          { slot: 1, id: 'bloodrite', name: 'Bloodrite', nodes: ['a', 'b'] },
        ],
        carvings: { points: 6, nodes: [] },
        attributes: { strength: 212, dexterity: 40.4 },
        cosmetics: [{ slot: 'Back', id: 'ash_cloak', name: 'Ash Cloak' }],
        border: 'pit_50',
      },
    });
    const read = Object.fromEntries(
      sections.map((section) => [
        section.title,
        Object.fromEntries(section.rows.map((row) => [row.label, row.value])),
      ]),
    );
    expect(read).toEqual({
      Progress: {
        'Talent points': '41 of 45',
        'Talents taken': '3',
        Carvings: '6 points',
        Marks: '120',
        Overlevels: '2',
      },
      Attributes: { Strength: '212', Dexterity: '40' },
      'Skills in use': { 'Main skill': 'Cleave', Movement: 'Leap Slam' },
      Ascendancy: { 'Rite 1': 'Bloodrite · 2 nodes' },
      Atlas: {
        'Highest tier': 'T12',
        'Places cleared': '9',
        'Charts run': '140',
        'Atlas nodes': '2',
      },
      Look: {
        'Avatar border': "Pit's Floor (Clear floor 50 of the Bone Pit)",
        Back: 'Ash Cloak',
      },
    });
  });

  test('leave out what is absent or not the shape the game writes', () => {
    expect(
      buildFacts({
        talents: { points: 'many', nodes: 'all' },
        atlas: {},
        extras: {
          rites: [null, 7, { slot: 2 }],
          border: 'gold',
          cosmetics: {},
        },
      }),
    ).toEqual([]);
  });
});

describe('player pages', () => {
  test("a record's board reads as the boards name it, the hardcore twin too", () => {
    expect(recordBoard('pit_floor')).toEqual({
      title: 'Deepest Bone Pit floor',
      format: 'number',
      path: '/boards/pit_floor',
    });
    expect(recordBoard('hc_map_s16')).toEqual({
      title: 'Hardcore fastest S16 map clear',
      format: 'time_ms',
      path: '/boards/map_s16?hardcore=true',
    });
    expect(recordBoard('trial_v')).toEqual({
      title: 'trial_v',
      format: 'number',
      path: '',
    });
  });

  test("the player's picture wears the best border any hero has", () => {
    const withBorder = (border: unknown) =>
      ({ build: { extras: { border } } }) as never;
    expect(bestBorder([])).toBeNull();
    expect(
      bestBorder([
        withBorder('tier_12'),
        withBorder('pit_30'),
        withBorder('nonsense'),
        { build: null } as never,
      ]),
    ).toBe('tier_12');
    expect(bestBorder([withBorder('pinnacle'), withBorder('hall_gold')])).toBe(
      'pinnacle',
    );
  });
});
