import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Logger, provide } from '@dunx/core';
import {
  PRESENCE_TTL_SECONDS,
  type ChatConversations,
  type FriendView,
  type RequestOutcome,
} from '@gravoth/contracts';
import type { AppRedis } from './cache/app-redis.js';
import {
  PRESENCE_REFRESH_MS,
  PresenceStore,
  RedisPresenceStore,
  presenceKey,
} from './presence/presence.js';
import { startTestApp, type TestApp } from './testing/app.js';
import { call, guest, signUp, type Player } from './testing/http.js';

/**
 * Friends' online status (v0.14.4): a signed-in request marks its caller (at most once per refresh window), a friend
 * shows as online while the mark lives and their `showOnline` is on, in the friends list, an accepted request and the
 * conversations (friends only). The store is stood in with a clock the suite moves; a last app runs over a Redis that
 * cannot be reached, where everyone is offline and every request still answers.
 */
class ClockedStore extends PresenceStore {
  clock = 1_000_000;
  marks = 0;
  readonly until = new Map<string, number>();

  override async mark(userId: string, seconds: number): Promise<void> {
    this.marks += 1;
    this.until.set(userId, this.clock + seconds * 1000);
  }

  override async live(
    userIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    return new Set(
      userIds.filter((id) => (this.until.get(id) ?? 0) > this.clock),
    );
  }

  override now(): number {
    return this.clock;
  }
}

const store = new ClockedStore();
let started: TestApp;
let base = '';
let ana: Player;
let bo: Player;
let cy: Player;

const get = <T>(path: string, who: Player) =>
  call<T>(base, 'GET', path, { token: who.token });
const post = <T>(path: string, who: Player, body: unknown = {}) =>
  call<T>(base, 'POST', path, { token: who.token, body });
const patch = (who: Player, body: unknown) =>
  call(base, 'PATCH', '/api/profile', { token: who.token, body });

/** Whether `who` sees `friend` online in their friends list. */
const seesOnline = async (who: Player, friend: Player) => {
  const list = await get<{ data: FriendView[] }>('/api/friends', who);
  expect(list.status).toBe(200);
  const row = list.body.data.find((f) => f.userId === friend.id);
  expect(row).toBeDefined();
  return row?.online;
};

/** Every mark gone, as when the time to live has passed for everyone. */
const expireAll = () => {
  store.clock += (PRESENCE_TTL_SECONDS + 1) * 1000;
};

beforeAll(async () => {
  started = await startTestApp({
    overrides: [provide(PresenceStore, { useValue: store })],
  });
  base = started.base;
  ana = await signUp(base, 'Ana', 'ana@presence.test');
  bo = await signUp(base, 'Bodhi', 'bo@presence.test');
  cy = await signUp(base, 'Cyra', 'cy@presence.test');
  const asked = await post<{ request: { id: string } }>(
    '/api/friends/requests',
    ana,
    { displayName: bo.displayName },
  );
  await post(`/api/friends/requests/${asked.body.request.id}/accept`, bo);
});

afterAll(async () => {
  await started.close();
});

describe('a friend', () => {
  it('is online within the time to live of their last signed-in request, and offline after it', async () => {
    expireAll();
    expect(await seesOnline(ana, bo)).toBe(false);
    await get('/api/profile', bo);
    expect(await seesOnline(ana, bo)).toBe(true);
    store.clock += (PRESENCE_TTL_SECONDS - 1) * 1000;
    expect(await seesOnline(ana, bo)).toBe(true);
    store.clock += 2_000;
    expect(await seesOnline(ana, bo)).toBe(false);
    // Any signed-in route marks: the game's realm read, here.
    await get('/api/realm', bo);
    expect(await seesOnline(ana, bo)).toBe(true);
  });

  it('is marked at most once per refresh window, however often they call', async () => {
    expireAll();
    await get('/api/profile', bo);
    const after = store.marks;
    for (let i = 0; i < 5; i++) await get('/api/heroes', bo);
    expect(store.marks).toBe(after);
    store.clock += PRESENCE_REFRESH_MS;
    await get('/api/heroes', bo);
    expect(store.marks).toBe(after + 1);
  });

  it('is never marked by a public route, and a guest never at all', async () => {
    expireAll();
    const before = store.marks;
    await call(base, 'GET', '/api/leaderboards');
    await call(base, 'GET', `/api/players/${bo.id}`, { token: bo.token });
    const visitor = await guest(base);
    expect((await get('/api/heroes', visitor)).status).toBe(200);
    expect(store.marks).toBe(before);
    expect(await seesOnline(bo, ana)).toBe(false);
  });

  it('is offline to everyone while their showOnline is off', async () => {
    expireAll();
    expect((await patch(bo, { showOnline: false })).status).toBe(200);
    await get('/api/profile', bo);
    expect(store.until.get(bo.id) ?? 0).toBeGreaterThan(store.clock);
    expect(await seesOnline(ana, bo)).toBe(false);
    expect((await patch(bo, { showOnline: true })).status).toBe(200);
    expect(await seesOnline(ana, bo)).toBe(true);
  });

  it('shows online in the answer to an accepted request', async () => {
    expireAll();
    const asked = await post<{ request: { id: string } }>(
      '/api/friends/requests',
      cy,
      { displayName: ana.displayName },
    );
    const accepted = await post<FriendView>(
      `/api/friends/requests/${asked.body.request.id}/accept`,
      ana,
    );
    expect(accepted.body).toMatchObject({ userId: cy.id, online: true });
    // Asking back accepts theirs, and answers the friend as well.
    store.clock += PRESENCE_REFRESH_MS;
    await post(`/api/friends/${cy.id}/remove`, ana);
    const again = await post<{ request: { id: string } }>(
      '/api/friends/requests',
      ana,
      { displayName: cy.displayName },
    );
    expireAll();
    const back = await post<RequestOutcome>('/api/friends/requests', cy, {
      displayName: ana.displayName,
    });
    expect(again.status).toBe(200);
    expect(back.body).toMatchObject({
      status: 'accepted',
      friend: { userId: ana.id, online: false },
    });
  });
});

describe('a conversation', () => {
  it('shows its peer online while they are a friend, and never once they are not', async () => {
    for (const who of [ana, bo])
      expect((await post('/api/chat/rules/accept', who)).status).toBe(200);
    expect(
      (await post(`/api/chat/direct/${bo.id}`, ana, { body: 'hi Bodhi' }))
        .status,
    ).toBe(200);
    expireAll();
    const peerOnline = async () => {
      const list = await get<ChatConversations>('/api/chat/direct', ana);
      expect(list.status).toBe(200);
      return list.body.conversations.find((c) => c.peer.userId === bo.id)
        ?.online;
    };
    expect(await peerOnline()).toBe(false);
    // The last line is the caller's own: it carries their name, not an empty one.
    const mine = await get<ChatConversations>('/api/chat/direct', ana);
    expect(
      mine.body.conversations.find((c) => c.peer.userId === bo.id)?.last?.from,
    ).toMatchObject({ userId: ana.id, displayName: ana.displayName });
    store.clock += PRESENCE_REFRESH_MS;
    await get('/api/chat/unread', bo);
    expect(await peerOnline()).toBe(true);
    expect((await post(`/api/friends/${bo.id}/remove`, ana)).status).toBe(200);
    expect(await peerOnline()).toBe(false);
  });
});

describe('the store over Redis', () => {
  const logger = {
    warn: () => undefined,
  } as unknown as Logger;
  const sets: unknown[][] = [];
  const working = {
    set: async (...args: unknown[]) => {
      sets.push(args);
      return 'OK';
    },
    mget: async (...keys: string[]) =>
      keys.map((key) => (key.endsWith(':b') ? '1' : null)),
  } as unknown as AppRedis;

  it('sets a key per player with the time to live, and reads them with one MGET', async () => {
    const redis = new RedisPresenceStore(working, logger);
    await redis.mark('a', PRESENCE_TTL_SECONDS);
    expect(sets).toEqual([[presenceKey('a'), '1', { ex: 120 }]]);
    expect([...(await redis.live(['a', 'b', 'c']))]).toEqual(['b']);
    expect((await redis.live([])).size).toBe(0);
  });

  it('never throws when Redis fails, at once or later', async () => {
    for (const fail of [
      () => {
        throw new Error('connection closed');
      },
      async () => {
        throw new Error('connection refused');
      },
    ]) {
      const broken = { set: fail, mget: fail } as unknown as AppRedis;
      const redis = new RedisPresenceStore(broken, logger);
      expect(await redis.mark('a', 120)).toBeUndefined();
      expect((await redis.live(['a'])).size).toBe(0);
    }
  });
});

describe('with Redis unreachable', () => {
  let down: TestApp;
  let ed: Player;
  let flo: Player;

  beforeAll(async () => {
    down = await startTestApp({
      config: { REDIS_URL: 'redis://127.0.0.1:1' },
    });
    ed = await signUp(down.base, 'Edda', 'ed@presence.test');
    flo = await signUp(down.base, 'Flora', 'flo@presence.test');
    const asked = await call<{ request: { id: string } }>(
      down.base,
      'POST',
      '/api/friends/requests',
      { token: ed.token, body: { displayName: flo.displayName } },
    );
    await call(
      down.base,
      'POST',
      `/api/friends/requests/${asked.body.request.id}/accept`,
      { token: flo.token, body: {} },
    );
  });

  afterAll(async () => {
    await down.close();
  });

  it('answers every request, everyone offline', async () => {
    expect(
      (await call(down.base, 'GET', '/api/profile', { token: flo.token }))
        .status,
    ).toBe(200);
    const list = await call<{ data: FriendView[] }>(
      down.base,
      'GET',
      '/api/friends',
      { token: ed.token },
    );
    expect(list.status).toBe(200);
    expect(list.body.data).toMatchObject([{ userId: flo.id, online: false }]);
    const conversations = await call<ChatConversations>(
      down.base,
      'GET',
      '/api/chat/direct',
      { token: ed.token },
    );
    expect(conversations.status).toBe(200);
  });
});
