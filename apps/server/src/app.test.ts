import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { startTestApp, type TestApp } from './testing/app.js';

/**
 * The app as it boots: Gravoth's own routes answer, and the scaffold's example routes
 * (ledger, catalog, reports, trace, limits, the cache sessions, the chat lobby, the
 * profile demo) are gone, so nothing but what the game needs faces the tunnel.
 */
let started: TestApp;
let base = '';

beforeAll(async () => {
  started = await startTestApp();
  base = started.base;
});

afterAll(async () => {
  await started.close();
});

describe('Gravoth routes', () => {
  it('answers /api/health while the process serves: Postgres up, the rules checker down', async () => {
    const response = await fetch(`${base}/api/health`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      database: string;
      validator: string;
      uptimeSeconds: number;
    };
    expect(body.status).toBe('ok');
    // No validator runs beside a test.
    expect(body.validator).toBe('down');
    expect(body.database).toBe('up');
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('answers /api/meta with the service name and the oldest game it serves', async () => {
    const response = await fetch(`${base}/api/meta`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      service: string;
      minGameVersion: string;
    };
    expect(body.service).toBe('gravoth');
    expect(body.minGameVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('accounts with nothing configured', () => {
  it('offers guest and email sign-in only, with no OAuth client set', async () => {
    const response = await fetch(`${base}/api/account/methods`);

    expect(await response.json()).toEqual({ methods: ['guest', 'email'] });
  });
});

describe('the scaffold examples are gone', () => {
  const removed = [
    'ledger',
    'ledger/page',
    'catalog',
    'catalog/dunx',
    'reports',
    'reports/health',
    'trace',
    'limits/burst',
    'limits/exempt',
    'cache',
    'cache/demo',
    // `/api/profile` is the player's own profile now (social/); the demo's sub-routes stay gone.
    'profile/audit',
    'profile/anonymous',
    'chat',
  ];

  for (const path of removed) {
    it(`/api/${path} is not found`, async () => {
      const response = await fetch(`${base}/api/${path}`);

      expect(response.status).toBe(404);
    });
  }

  it('documents exactly the game, account, profile, friends, heroes, player, board and cloud save routes', async () => {
    const response = await fetch(`${base}/api/openapi.json`);
    expect(response.status).toBe(200);
    const document = (await response.json()) as {
      paths: Record<string, unknown>;
    };

    // better-auth's own endpoints are contributed under /api/auth; everything else is ours.
    const ours = Object.keys(document.paths)
      .filter((path) => !path.startsWith('/api/auth/'))
      .sort();
    expect(ours).toEqual([
      '/api/account',
      '/api/account/delete',
      '/api/account/email-verified',
      '/api/account/game-sign-in',
      '/api/account/game-sign-in/done',
      '/api/account/game-sign-in/exchange',
      '/api/account/methods',
      '/api/account/reset-password',
      '/api/blocks',
      '/api/blocks/{userId}/remove',
      '/api/builds/{id}',
      '/api/friends',
      '/api/friends/requests',
      '/api/friends/requests/incoming',
      '/api/friends/requests/outgoing',
      '/api/friends/requests/{id}/accept',
      '/api/friends/requests/{id}/cancel',
      '/api/friends/requests/{id}/decline',
      '/api/friends/{userId}/remove',
      '/api/health',
      '/api/heroes',
      '/api/heroes/active',
      '/api/heroes/{id}/builds',
      '/api/leaderboards',
      '/api/leaderboards/{key}',
      '/api/leaderboards/{key}/me',
      '/api/leaderboards/{key}/scores',
      '/api/meta',
      '/api/players/{userId}',
      '/api/profile',
      '/api/saves/me',
    ]);
  });
});
