import { describe, expect, test } from 'bun:test';
import { errorCode, withQuery } from './api.js';
import { formatCompact, formatScore, messageFor, titleOf } from './format.js';
import { matchPath } from './router.js';
import { safeNext } from './pages/sign-in.js';

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
