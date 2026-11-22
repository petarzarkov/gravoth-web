import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { provide } from '@dunx/core';
import { EmailTransport, MemoryTransport } from '@dunx/infra/email';
import { displayNameProblem } from './players/display-names.js';
import { startTestApp, type TestApp } from './testing/app.js';
import { call, guest, signUp, type Player } from './testing/http.js';

/**
 * Profiles, friends and blocks over HTTP, the way the game calls them. Each player is a real email account; mail is
 * caught by a memory transport.
 */
const mail = new MemoryTransport();
let started: TestApp;
let base = '';
let ana: Player;
let bo: Player;
let cy: Player;

beforeAll(async () => {
  started = await startTestApp({ overrides: [provide(EmailTransport, { useValue: mail })] });
  base = started.base;
  ana = await signUp(base, 'Ana', 'ana@example.test');
  bo = await signUp(base, 'Bo', 'bo@example.test');
  cy = await signUp(base, 'Cy Rus', 'cy@example.test');
});

afterAll(async () => {
  await started.close();
});

const get = <T>(path: string, who: Player) => call<T>(base, 'GET', path, { token: who.token });
const post = <T>(path: string, who: Player, body: unknown = {}) => call<T>(base, 'POST', path, { token: who.token, body });

interface Page<T> {
  data: T[];
  meta: { hasNextPage: boolean; hasPreviousPage: boolean; nextCursor: string | null };
}
interface RequestView {
  id: string;
  userId: string;
  displayName: string;
  direction: 'incoming' | 'outgoing';
}

describe('profiles', () => {
  it('starts each account with a display name made from its sign-in name', () => {
    expect(ana.displayName).toBe('Ana');
    // "Bo" is under three letters, so it starts as a Hero with digits.
    expect(bo.displayName).toMatch(/^Hero\d{4}$/);
    // Letters and digits only.
    expect(cy.displayName).toBe('CyRus');
  });

  it('gives a guest a Guest name with digits', async () => {
    expect((await guest(base)).displayName).toMatch(/^Guest\d{4}$/);
  });

  it('renames under the format, the word filter and case-insensitive uniqueness', async () => {
    const rename = (displayName: string) => call(base, 'PATCH', '/api/profile', { token: bo.token, body: { displayName } });

    expect((await rename('B')).status).toBe(400);
    expect((await rename('has space')).status).toBe(400);
    expect((await rename('ANA')).status).toBe(409);
    expect((await rename('GravothStaff')).status).toBe(422);
    expect((await rename('Sh1t99')).status).toBe(422);

    const renamed = await rename('Bodhi');
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ displayName: 'Bodhi', nameChosen: true });
    bo = { ...bo, displayName: 'Bodhi' };
  });

  it('keeps the privacy flags it is given and leaves the rest', async () => {
    const changed = await call(base, 'PATCH', '/api/profile', { token: cy.token, body: { showOnline: false } });

    expect(changed.body).toMatchObject({ showOnline: false, publicProfile: true, allowFriendRequests: true, emailFriendRequests: true });
  });

  it('filters look-alikes and whole words, and lets ordinary names through', () => {
    expect(displayNameProblem('Fvck_you')).toBe('not-allowed');
    expect(displayNameProblem('Admin_7')).toBe('not-allowed');
    expect(displayNameProblem('Assassin')).toBeUndefined();
    expect(displayNameProblem('Grapefruit')).toBeUndefined();
    expect(displayNameProblem('Kriso-the-Second')).toBeUndefined();
  });
});

describe('friend requests', () => {
  let request: RequestView;

  it('goes to a display name in any case and waits on both sides', async () => {
    const sent = await post<{ status: string; request: RequestView }>('/api/friends/requests', ana, { displayName: 'bodhi' });

    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe('pending');
    request = sent.body.request;
    expect(request).toMatchObject({ userId: bo.id, displayName: 'Bodhi', direction: 'outgoing' });

    const incoming = await get<Page<RequestView>>('/api/friends/requests/incoming', bo);
    expect(incoming.body.data).toEqual([expect.objectContaining({ id: request.id, userId: ana.id, displayName: 'Ana', direction: 'incoming' })]);
    expect((await get<Page<RequestView>>('/api/friends/requests/outgoing', ana)).body.data.map((r) => r.id)).toEqual([request.id]);
  });

  it('refuses a second request either way while one stands, and asking oneself or nobody', async () => {
    expect((await post<{ code?: string }>('/api/friends/requests', ana, { displayName: 'Bodhi' })).status).toBe(409);
    expect((await post('/api/friends/requests', ana, { displayName: 'Ana' })).status).toBe(400);
    expect((await post('/api/friends/requests', ana, { displayName: 'Nobody123' })).status).toBe(404);
  });

  it('is accepted by the addressee only, and then both list each other', async () => {
    expect((await post(`/api/friends/requests/${request.id}/accept`, ana)).status).toBe(404);

    const accepted = await post<{ userId: string; displayName: string }>(`/api/friends/requests/${request.id}/accept`, bo);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ userId: ana.id, displayName: 'Ana' });

    expect((await get<Page<{ userId: string }>>('/api/friends', ana)).body.data.map((f) => f.userId)).toEqual([bo.id]);
    expect((await get<Page<{ userId: string }>>('/api/friends', bo)).body.data.map((f) => f.userId)).toEqual([ana.id]);
    expect((await post('/api/friends/requests', bo, { displayName: 'Ana' })).status).toBe(409);
  });

  it('removes a friend for both', async () => {
    expect((await post(`/api/friends/${ana.id}/remove`, bo)).status).toBe(200);

    expect((await get<Page<unknown>>('/api/friends', ana)).body.data).toEqual([]);
    expect((await post(`/api/friends/${ana.id}/remove`, bo)).status).toBe(404);
  });

  it('accepts at once when the other had already asked', async () => {
    const first = await post<{ status: string }>('/api/friends/requests', cy, { displayName: 'Ana' });
    expect(first.body.status).toBe('pending');

    const back = await post<{ status: string; friend: { userId: string } }>('/api/friends/requests', ana, { displayName: 'CyRus' });
    expect(back.body).toMatchObject({ status: 'accepted', friend: { userId: cy.id } });
  });

  it('is declined by the addressee or cancelled by the requester, deleting it', async () => {
    const one = (await post<{ request: RequestView }>('/api/friends/requests', bo, { displayName: 'CyRus' })).body.request;
    expect((await post(`/api/friends/requests/${one.id}/decline`, bo)).status).toBe(404);
    expect((await post(`/api/friends/requests/${one.id}/decline`, cy)).status).toBe(200);
    expect((await get<Page<unknown>>('/api/friends/requests/incoming', cy)).body.data).toEqual([]);

    const two = (await post<{ request: RequestView }>('/api/friends/requests', bo, { displayName: 'CyRus' })).body.request;
    expect((await post(`/api/friends/requests/${two.id}/cancel`, cy)).status).toBe(404);
    expect((await post(`/api/friends/requests/${two.id}/cancel`, bo)).status).toBe(200);
    expect((await get<Page<unknown>>('/api/friends/requests/outgoing', bo)).body.data).toEqual([]);
  });

  it('is refused by a profile closed to requests, and to and from a guest', async () => {
    await call(base, 'PATCH', '/api/profile', { token: cy.token, body: { allowFriendRequests: false } });
    expect((await post('/api/friends/requests', bo, { displayName: 'CyRus' })).status).toBe(403);
    await call(base, 'PATCH', '/api/profile', { token: cy.token, body: { allowFriendRequests: true } });

    const visitor = await guest(base);
    expect((await post('/api/friends/requests', visitor, { displayName: 'Ana' })).status).toBe(403);
    expect((await post('/api/friends/requests', ana, { displayName: visitor.displayName })).status).toBe(404);
  });

  it('mails a confirmed address, and nobody else', async () => {
    const before = mail.sent.length;
    await post('/api/friends/requests', bo, { displayName: 'Ana' });
    // Ana has not confirmed her address.
    expect(mail.sent.length).toBe(before);

    const link = mail.to('cy@example.test')[0]?.text?.match(/https?:\/\/\S+/)?.[0] ?? '';
    expect((await fetch(link.replace(/^https?:\/\/[^/]+/, base), { redirect: 'manual' })).status).toBe(302);
    await post('/api/friends/requests', bo, { displayName: 'CyRus' });
    const sent = mail.to('cy@example.test').at(-1);
    expect(sent?.subject).toBe('Bodhi sent you a friend request in Gravoth');
    expect(sent?.text).toContain('Bodhi sent you a friend request');
  });

  it('pages a long list with a cursor', async () => {
    const host = await signUp(base, 'Host', 'host@example.test');
    for (const n of [1, 2, 3]) {
      const guestOf = await signUp(base, `Pal${n}x`, `pal${n}@example.test`);
      await post('/api/friends/requests', guestOf, { displayName: host.displayName });
    }

    const first = await get<Page<RequestView>>('/api/friends/requests/incoming?take=2', host);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta.hasNextPage).toBe(true);
    const second = await get<Page<RequestView>>(`/api/friends/requests/incoming?take=2&cursor=${first.body.meta.nextCursor}`, host);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.meta.hasNextPage).toBe(false);
    const all = [...first.body.data, ...second.body.data].map((r) => r.displayName);
    expect(new Set(all)).toEqual(new Set(['Pal1x', 'Pal2x', 'Pal3x']));
  });
});

describe('blocks', () => {
  it('ends the friendship, hides the blocker from the blocked, and lifts again', async () => {
    // Ana and Cy are friends (above).
    const blocked = await post<{ userId: string; displayName: string }>('/api/blocks', cy, { displayName: 'Ana' });
    expect(blocked.status).toBe(200);
    expect(blocked.body).toMatchObject({ userId: ana.id, displayName: 'Ana' });
    expect((await get<Page<unknown>>('/api/friends', cy)).body.data).toEqual([]);

    expect((await post('/api/friends/requests', ana, { displayName: 'CyRus' })).status).toBe(404);
    expect((await post('/api/friends/requests', cy, { displayName: 'Ana' })).status).toBe(409);
    expect((await get<Page<{ userId: string }>>('/api/blocks', cy)).body.data.map((b) => b.userId)).toEqual([ana.id]);

    expect((await post(`/api/blocks/${ana.id}/remove`, cy)).status).toBe(200);
    expect((await post(`/api/blocks/${ana.id}/remove`, cy)).status).toBe(404);
    expect((await post<{ status: string }>('/api/friends/requests', ana, { displayName: 'CyRus' })).status).toBe(200);
  });

  it('refuses blocking oneself, and needs a session', async () => {
    expect((await post('/api/blocks', ana, { displayName: 'Ana' })).status).toBe(400);
    expect((await call(base, 'GET', '/api/blocks')).status).toBe(401);
    expect((await call(base, 'GET', '/api/friends')).status).toBe(401);
  });
});
