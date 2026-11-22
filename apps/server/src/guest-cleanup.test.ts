import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Logger } from '@dunx/core';
import { ScheduleRegistry } from '@dunx/infra/schedule';
import { GAME_CLIENT_HEADER } from '@gravoth/contracts';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import * as schema from './database/schema.js';
import { GuestCleanup } from './players/guest-cleanup.js';
import { startTestApp, type TestApp } from './testing/app.js';
import { call, guest, signUp, type Player } from './testing/http.js';

/**
 * The daily clean-up of guests (decision 224): a guest with no heroes (so no records) and no use in 30 days is deleted
 * with everything kept for it; a guest that played, one with a hero, and every account are kept. Rows are backdated in
 * the database, as 30 days would leave them.
 */
let started: TestApp;
let base = '';
let db: SQL;

beforeAll(async () => {
  started = await startTestApp();
  base = started.base;
  db = new SQL(started.database.url, { max: 1 });
});

afterAll(async () => {
  await db.close();
  await started.close();
});

/** The player's user row made `days` ago, and every session of theirs last used then. */
const age = async (player: Player, days: number) => {
  const then = new Date(Date.now() - days * 86_400_000);
  await db`UPDATE users SET created_at = ${then} WHERE id = ${player.id}`;
  await db`UPDATE sessions SET created_at = ${then}, updated_at = ${then} WHERE user_id = ${player.id}`;
};

const exists = async (player: Player): Promise<boolean> =>
  (
    (await db`SELECT count(*)::int AS n FROM users WHERE id = ${player.id}`) as {
      n: number;
    }[]
  )[0]?.n === 1;

describe('the guest clean-up', () => {
  it('is armed daily at 04:15, after the backup', () => {
    const entry = started.app.get(ScheduleRegistry).get('guest-cleanup');
    expect(entry).toMatchObject({ kind: 'cron', at: '15 4 * * *' });
  });

  it('deletes the guests with no records unused for 30 days, and nothing else', async () => {
    const idle = await guest(base);
    await age(idle, 31);

    const sessionless = await guest(base);
    await age(sessionless, 45);
    await db`DELETE FROM sessions WHERE user_id = ${sessionless.id}`;

    const recent = await guest(base);
    await age(recent, 40);
    await db`UPDATE sessions SET updated_at = now() - interval '2 days' WHERE user_id = ${recent.id}`;

    const young = await guest(base);
    await age(young, 10);
    await db`DELETE FROM sessions WHERE user_id = ${young.id}`;

    const withHero = await guest(base);
    expect(
      (
        await call(base, 'POST', '/api/heroes', {
          token: withHero.token,
          body: { name: 'Keeper', class: 'templar' },
        })
      ).status,
    ).toBe(200);
    await age(withHero, 90);

    const account = await signUp(base, 'Old', 'old-account@example.test');
    await age(account, 90);

    // A game session is never renewed by better-auth; the game's launch (GET /api/account) marks it used.
    const player = await guest(base);
    await age(player, 31);
    const launch = await fetch(`${base}/api/account`, {
      headers: {
        authorization: `Bearer ${player.token}`,
        [GAME_CLIENT_HEADER]: 'game/0.13.0',
      },
    });
    expect(launch.status).toBe(200);

    const lines: { message: string; fields: unknown }[] = [];
    const logger = {
      info: (message: string, fields: unknown) =>
        lines.push({ message, fields }),
      error: (message: string, fields: unknown) =>
        lines.push({ message, fields }),
    } as unknown as Logger;
    const cleanup = new GuestCleanup(
      drizzle({ client: db, schema }) as never,
      logger,
    );
    expect(await cleanup.run()).toBe(2);
    expect(lines).toEqual([
      { message: 'guest clean-up', fields: { removed: 2, idleDays: 30 } },
    ]);

    expect(await exists(idle)).toBe(false);
    expect(await exists(sessionless)).toBe(false);
    for (const kept of [recent, young, withHero, account, player])
      expect(await exists(kept)).toBe(true);
    // The deleted guests' sessions and profiles went with them.
    const left = (await db`
      SELECT (SELECT count(*)::int FROM sessions WHERE user_id = ${idle.id}) AS sessions,
             (SELECT count(*)::int FROM profiles WHERE user_id IN (${idle.id}, ${sessionless.id})) AS profiles`) as {
      sessions: number;
      profiles: number;
    }[];
    expect(left[0]).toEqual({ sessions: 0, profiles: 0 });
    // A deleted guest's token no longer signs anyone in.
    expect(
      (await call(base, 'GET', '/api/account', { token: idle.token })).status,
    ).toBe(401);

    // The schedule runs the same job: nothing more to remove.
    await started.app.get(ScheduleRegistry).trigger('guest-cleanup');
    for (const kept of [recent, young, withHero, account, player])
      expect(await exists(kept)).toBe(true);
  });

  it('marks a session used at most once a day, from the account route', async () => {
    const player = await guest(base);
    const yesterday = new Date(Date.now() - 2 * 86_400_000);
    const hourAgo = new Date(Date.now() - 3_600_000);
    const read = async () =>
      (
        (await db`SELECT updated_at FROM sessions WHERE user_id = ${player.id}`) as {
          updated_at: Date;
        }[]
      )[0]?.updated_at.getTime() ?? 0;

    await db`UPDATE sessions SET updated_at = ${hourAgo} WHERE user_id = ${player.id}`;
    await call(base, 'GET', '/api/account', { token: player.token });
    expect(await read()).toBe(hourAgo.getTime());

    await db`UPDATE sessions SET updated_at = ${yesterday} WHERE user_id = ${player.id}`;
    await call(base, 'GET', '/api/account', { token: player.token });
    expect(await read()).toBeGreaterThan(Date.now() - 60_000);
  });
});
