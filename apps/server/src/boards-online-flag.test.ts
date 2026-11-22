import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { BoardPage, SubmitResult } from '@gravoth/contracts';
import { startTestApp, type TestApp } from './testing/app.js';
import { call, guest } from './testing/http.js';

/**
 * Decision 227's switch: with BOARDS_ONLINE_ONLY off (production until the release that makes online heroes ships), an
 * offline hero's score is on the board as v0.13.0 expects; the other suites run with it on.
 */
let started: TestApp;
let base = '';

beforeAll(async () => {
  started = await startTestApp({ config: { BOARDS_ONLINE_ONLY: 'false' } });
  base = started.base;
});

afterAll(async () => {
  await started.close();
});

describe('BOARDS_ONLINE_ONLY off', () => {
  it("shows an offline hero's score with its rank", async () => {
    const player = await guest(base);
    const made = await call<{ hero: { id: string } }>(
      base,
      'POST',
      '/api/heroes',
      {
        token: player.token,
        body: { name: 'Offline', class: 'barbarian' },
      },
    );
    const scored = await call<SubmitResult>(
      base,
      'POST',
      '/api/leaderboards/pit_floor/scores',
      {
        token: player.token,
        body: {
          heroId: made.body.hero.id,
          score: 41,
          build: {
            revision: 1,
            gameVersion: '0.13.0',
            level: 60,
            skills: [],
            gear: [],
            talents: {},
            summary: { dps: 1, clearDps: 1, ehp: 1, life: 1 },
          },
        },
      },
    );
    expect(scored.status).toBe(200);
    expect(scored.body.entry).toMatchObject({ score: 41, rank: 1 });
    const page = await call<BoardPage>(
      base,
      'GET',
      '/api/leaderboards/pit_floor',
    );
    expect(page.body.entries.data.map((row) => row.hero.name)).toEqual([
      'Offline',
    ]);
  });
});
