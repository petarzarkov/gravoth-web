import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ScheduleRegistry } from '@dunx/infra/schedule';
import {
  SUGGESTION_LIMITS,
  type SuggestionList,
  type SuggestionView,
} from '@gravoth/contracts';
import { SQL } from 'bun';
import { and, eq } from 'drizzle-orm';
import { Db } from './database/db.js';
import { checkViolation, isUniqueViolation } from './database/errors.js';
import {
  block,
  chatMessage,
  friendship,
  hero,
  heroBuild,
  leaderboard,
  leaderboardEntry,
  profile,
  session,
  suggestionDismissal,
  user,
} from './database/schema.js';
import { noteOf } from './social/suggestions.service.js';
import { startTestApp, type TestApp } from './testing/app.js';
import { call, guest, signUp, type Player } from './testing/http.js';

/**
 * Friend suggestions (decision 229) over HTTP, the way the game calls them. The players a caller is suggested are made
 * straight in the database (a user and a profile, and no session, so none of them is recently active unless a test
 * says so), with their friendships, board records and chat messages backdated as the sources need; each caller is a
 * real account with a token, whose list is read once its world is in place (a list is cached for five minutes).
 *
 * `TRUST_PROXY` is on so the limit's test counts an address of its own.
 */
let started: TestApp;
let base = '';
let db: Db;
let raw: SQL;

beforeAll(async () => {
  started = await startTestApp({ config: { TRUST_PROXY: 'true' } });
  base = started.base;
  db = started.app.get(Db);
  raw = new SQL(started.database.url, { max: 1 });
});

afterAll(async () => {
  await raw.close();
  await started.close();
});

const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms);

interface Someone {
  readonly id: string;
  readonly displayName: string;
}

let made = 0;
/** A player straight in the database: no session, so not recently active. */
const someone = async (
  name: string,
  options: {
    guest?: boolean;
    publicProfile?: boolean;
    allowFriendRequests?: boolean;
  } = {},
): Promise<Someone> => {
  made += 1;
  const [row] = await db
    .insert(user)
    .values({
      name,
      email: `someone${made}@suggestions.test`,
      isAnonymous: options.guest ?? false,
    })
    .returning();
  if (row === undefined) throw new Error('no user');
  const displayName = `${name}${made}`;
  await db.insert(profile).values({
    userId: row.id,
    displayName,
    publicProfile: options.publicProfile ?? true,
    allowFriendRequests: options.allowFriendRequests ?? true,
  });
  return { id: row.id, displayName };
};

let signedUp = 0;
const caller = async (name: string): Promise<Player> => {
  signedUp += 1;
  return signUp(base, name, `caller${signedUp}@suggestions.test`);
};

const friends = async (a: Someone, ...others: Someone[]) => {
  for (const b of others)
    await db.insert(friendship).values({
      requesterId: a.id,
      addresseeId: b.id,
      status: 'accepted',
      respondedAt: new Date(),
    });
};

/** A session of theirs last used `days` ago: the signal of a recently active player. */
const usedAgo = async (who: Someone, days: number) => {
  await db.insert(session).values({
    userId: who.id,
    token: `token-${who.id}-${days}`,
    expiresAt: new Date(Date.now() + 30 * DAY),
    createdAt: ago(days * DAY),
    updatedAt: ago(days * DAY),
  });
};

const boardIdOf = async (key: string, hardcore = false): Promise<number> => {
  const [row] = await db
    .select({ id: leaderboard.id })
    .from(leaderboard)
    .where(
      and(
        eq(leaderboard.key, key),
        eq(leaderboard.hardcore, hardcore),
        eq(leaderboard.season, 0),
      ),
    );
  if (row === undefined) throw new Error(`no board ${key}`);
  return row.id;
};

let heroes = 0;
/** A hero of theirs (online unless said otherwise) with one build, holding `score` on the board. */
const record = async (
  who: Someone,
  key: string,
  score: number,
  options: { hardcore?: boolean; online?: boolean; flagged?: boolean } = {},
) => {
  heroes += 1;
  const online = options.online ?? true;
  const [row] = await db
    .insert(hero)
    .values({
      userId: who.id,
      name: `Hero${heroes}`,
      class: 'barbarian',
      hardcore: options.hardcore ?? false,
      online,
      realmCharacterId: online ? heroes : null,
      flagged: options.flagged ?? false,
    })
    .returning();
  if (row === undefined) throw new Error('no hero');
  const [build] = await db
    .insert(heroBuild)
    .values({
      heroId: row.id,
      revision: 1,
      gameVersion: '0.13.1',
      level: 50,
      dps: 1_000,
      clearDps: 800,
      ehp: 9_000,
      life: 2_500,
      skills: [{ id: 'cleave', level: 10, supports: [] }],
      gear: [],
      talents: {},
      summary: {
        dps: 1_000,
        clearDps: 800,
        ehp: 9_000,
        life: 2_500,
        energyShield: 0,
      },
      contentHash: heroes.toString(16).padStart(64, '0'),
    })
    .returning();
  if (build === undefined) throw new Error('no build');
  await db.insert(leaderboardEntry).values({
    boardId: await boardIdOf(key, options.hardcore ?? false),
    userId: who.id,
    heroId: row.id,
    buildId: build.id,
    score,
    achievedAt: ago(60_000),
    verdict: 'verified',
  });
};

/** A global message of theirs, `minutes` ago. */
const said = async (
  who: Someone,
  minutes: number,
  options: { hidden?: boolean; to?: Someone } = {},
) => {
  await db.insert(chatMessage).values({
    channel: options.to === undefined ? 'global' : 'direct',
    senderId: who.id,
    recipientId: options.to?.id ?? null,
    body: 'hello',
    createdAt: ago(minutes * 60_000),
    ...(options.hidden === true
      ? { hiddenAt: new Date(), hiddenBy: 'moderator' as const }
      : {}),
  });
};

/** Every `GET /api/friends/suggestions` this suite sends from its own address, for the limit's test. */
let reads = 0;
const suggestions = async (who: Player) => {
  reads += 1;
  return call<SuggestionList & { error?: string }>(
    base,
    'GET',
    '/api/friends/suggestions',
    { token: who.token },
  );
};
const listOf = async (who: Player): Promise<readonly SuggestionView[]> => {
  const reply = await suggestions(who);
  expect(reply.status).toBe(200);
  return reply.body.items;
};
const idsOf = (items: readonly SuggestionView[]) =>
  items.map((item) => item.userId);
const find = (items: readonly SuggestionView[], who: Someone) =>
  items.find((item) => item.userId === who.id);
const dismiss = (who: Player, userId: string) =>
  call<{ error?: string }>(
    base,
    'POST',
    `/api/friends/suggestions/${userId}/dismiss`,
    { token: who.token, body: {} },
  );

describe('friends of friends', () => {
  it("suggests the players the caller's friends are friends with, by how many they share", async () => {
    const me = await caller('Mia');
    const one = await someone('FriendA');
    const two = await someone('FriendB');
    const both = await someone('Both');
    const single = await someone('Single');
    await friends(me, one, two);
    await friends(one, both, single);
    await friends(two, both);

    const items = await listOf(me);
    expect(idsOf(items).slice(0, 2)).toEqual([both.id, single.id]);
    expect(items[0]).toMatchObject({
      userId: both.id,
      displayName: both.displayName,
      reasons: [{ kind: 'mutual', count: 2 }],
      note: '2 mutual friends',
    });
    expect(items[0]?.avatar.kind).toBe('portrait');
    expect(items[1]).toMatchObject({
      reasons: [{ kind: 'mutual', count: 1 }],
      note: '1 mutual friend',
    });
    // The caller's own friends are never suggested.
    expect(idsOf(items)).not.toContain(one.id);
    expect(idsOf(items)).not.toContain(two.id);
  });
});

describe('near you on the boards', () => {
  it("suggests the players within five places of the caller's best, as the boards rank them, on the closest board", async () => {
    const me = await caller('Bea');
    // Deepest Bone Pit floor, larger first: the caller is 7th, so 2nd to 12th are near.
    const top = await someone('Top');
    const [second, third, fourth, fifth, sixth] = [
      await someone('Second'),
      await someone('Third'),
      await someone('Fourth'),
      await someone('Fifth'),
      await someone('Sixth'),
    ] as const;
    const below = [];
    for (let i = 0; i < 6; i++) below.push(await someone(`Below${i}`));
    await record(top, 'pit_floor', 900);
    await record(second, 'pit_floor', 890);
    await record(third, 'pit_floor', 880);
    await record(fourth, 'pit_floor', 870);
    await record(fifth, 'pit_floor', 860);
    await record(sixth, 'pit_floor', 850);
    await record(me, 'pit_floor', 800);
    // The caller's weaker hero changes nothing: their best is what counts.
    await record(me, 'pit_floor', 100);
    for (const [i, who] of below.entries())
      await record(who, 'pit_floor', 790 - i * 10);
    // Not on the board as it shows: an offline hero, a flagged one, a hero the checker flagged.
    const offline = await someone('Offline');
    await record(offline, 'pit_floor', 895, { online: false });
    const cheat = await someone('Cheat');
    await record(cheat, 'pit_floor', 885, { flagged: true });
    // Most Marks: the fourth is right beside the caller there, closer than on the pit floor.
    await record(fourth, 'marks', 500);
    await record(me, 'marks', 499);
    // The hardcore twin, by its own key.
    const brave = await someone('Brave');
    await record(brave, 'pit_floor', 40, { hardcore: true });
    await record(me, 'pit_floor', 30, { hardcore: true });

    const items = await listOf(me);
    const reason = (who: Someone) =>
      find(items, who)?.reasons.find((r) => r.kind === 'board');

    expect(find(items, top)).toBeUndefined();
    expect(reason(second)).toEqual({
      kind: 'board',
      boardId: 'pit_floor',
      boardTitle: 'Deepest Bone Pit floor',
      yourRank: 7,
      theirRank: 2,
    });
    expect(reason(sixth)).toMatchObject({ yourRank: 7, theirRank: 6 });
    expect(reason(fourth)).toEqual({
      kind: 'board',
      boardId: 'marks',
      boardTitle: 'Most Marks',
      yourRank: 2,
      theirRank: 1,
    });
    expect(find(items, fourth)?.note).toBe('Near you on Most Marks');
    // Below: 8th to 12th; the 13th is too far (and the caller's weaker hero, 14th, is theirs).
    expect(reason(below[0]!)).toMatchObject({ theirRank: 8 });
    expect(reason(below[3]!)).toMatchObject({ theirRank: 11 });
    expect(reason(below[4]!)).toMatchObject({ theirRank: 12 });
    expect(find(items, below[5]!)).toBeUndefined();
    expect(find(items, offline)).toBeUndefined();
    expect(find(items, cheat)).toBeUndefined();
    expect(reason(brave)).toEqual({
      kind: 'board',
      boardId: 'hc_pit_floor',
      boardTitle: 'Hardcore deepest Bone Pit floor',
      yourRank: 2,
      theirRank: 1,
    });
    // Closer first: the marks neighbour and the hardcore one (one place away) before the second (five).
    const order = idsOf(items);
    expect(order.indexOf(fourth.id)).toBeLessThan(order.indexOf(second.id));
    expect(order.indexOf(brave.id)).toBeLessThan(order.indexOf(second.id));
  });
});

describe('recent chat partners', () => {
  it('suggests who wrote in Global within 30 minutes of the caller in the last week, hidden messages left out', async () => {
    const me = await caller('Cleo');
    const near = await someone('Near');
    const late = await someone('Late');
    const hidden = await someone('Hidden');
    const whisper = await someone('Whisper');
    const old = await someone('Old');
    await said(me, 24 * 60);
    await said(near, 24 * 60 - 25);
    await said(late, 24 * 60 + 35);
    await said(hidden, 24 * 60 - 5, { hidden: true });
    await said(whisper, 24 * 60 - 5, { to: me });
    await said(me, 8 * 24 * 60);
    await said(old, 8 * 24 * 60 - 1);

    const items = await listOf(me);
    expect(find(items, near)).toMatchObject({
      reasons: [{ kind: 'chat' }],
      note: 'Chatted with you in Global',
    });
    for (const who of [late, hidden, whisper, old])
      expect(find(items, who)).toBeUndefined();
  });
});

describe('recently active players', () => {
  it('fill the list with whoever played this week', async () => {
    const me = await caller('Ada');
    const recent = await someone('Recent');
    const lapsed = await someone('Lapsed');
    await usedAgo(recent, 0);
    await usedAgo(lapsed, 8);

    const items = await listOf(me);
    expect(find(items, recent)).toMatchObject({
      reasons: [{ kind: 'active' }],
      note: 'Played this week',
    });
    expect(find(items, lapsed)).toBeUndefined();
    // The newest first: Recent's session is newer than any caller's.
    expect(items[0]?.userId).toBe(recent.id);
  });

  it('are only a fill: a full list from the other sources leaves them out', async () => {
    const me = await caller('Max');
    const hub = await someone('Hub');
    await friends(me, hub);
    const many: Someone[] = [];
    for (let i = 0; i < SUGGESTION_LIMITS.MAX + 2; i++)
      many.push(await someone(`Pal${i}x`));
    await friends(hub, ...many);

    const items = await listOf(me);
    expect(items).toHaveLength(SUGGESTION_LIMITS.MAX);
    expect(items.every((item) => item.reasons[0]?.kind === 'mutual')).toBe(
      true,
    );
    // Equal otherwise, they go by name.
    const names = items.map((item) => item.displayName.toLowerCase());
    expect(names).toEqual([...names].sort());
  });
});

describe('who is never suggested', () => {
  it('the caller, friends, requests either way, blocks either way, hidden or closed profiles, guests, dismissals', async () => {
    const me = await caller('Eve');
    const hub = await someone('Hub');
    await friends(me, hub);
    const control = await someone('Control');
    const friend = await someone('Friend');
    const asked = await someone('Asked');
    const asking = await someone('Asking');
    const blocked = await someone('Blocked');
    const blocker = await someone('Blocker');
    const hiddenProfile = await someone('Hidden', { publicProfile: false });
    const closed = await someone('Closed', { allowFriendRequests: false });
    const guestPlayer = await someone('Guest', { guest: true });
    const dismissed = await someone('Dismissed');
    const longAgo = await someone('LongAgo');
    const everyone = [
      control,
      friend,
      asked,
      asking,
      blocked,
      blocker,
      hiddenProfile,
      closed,
      guestPlayer,
      dismissed,
      longAgo,
    ];
    await friends(hub, ...everyone);
    await friends(me, friend);
    await db.insert(friendship).values([
      { requesterId: me.id, addresseeId: asked.id },
      { requesterId: asking.id, addresseeId: me.id },
    ]);
    await db.insert(block).values([
      { blockerId: me.id, blockedId: blocked.id },
      { blockerId: blocker.id, blockedId: me.id },
    ]);
    await raw`INSERT INTO suggestion_dismissals (user_id, dismissed_id, dismissed_at) VALUES
      (${me.id}, ${dismissed.id}, now() - interval '29 days'),
      (${me.id}, ${longAgo.id}, now() - interval '31 days')`;

    const items = await listOf(me);
    const ids = idsOf(items);
    expect(ids).toContain(control.id);
    expect(ids).toContain(longAgo.id);
    for (const who of [
      me,
      hub,
      friend,
      asked,
      asking,
      blocked,
      blocker,
      hiddenProfile,
      closed,
      guestPlayer,
      dismissed,
    ])
      expect(ids).not.toContain(who.id);
  });

  it('a guest from the recently active either', async () => {
    const me = await caller('Gil');
    const visitor = await guest(base);
    const ids = idsOf(await listOf(me));
    expect(ids).not.toContain(visitor.id);
  });
});

describe('ranking', () => {
  it('puts players found several ways first, then mutual friends, board distance, chat, and activity', async () => {
    const me = await caller('Rex');
    const [f1, f2, f3] = [
      await someone('Fa'),
      await someone('Fb'),
      await someone('Fc'),
    ] as const;
    await friends(me, f1, f2, f3);
    const three = await someone('Three');
    const two = await someone('Two');
    const mutual3 = await someone('Mutual3');
    const mutual1 = await someone('Mutual1');
    const boardClose = await someone('Close');
    const boardFar = await someone('Far');
    const chatOnly = await someone('Chat');
    await friends(f1, three, two, mutual3, mutual1);
    await friends(f2, mutual3);
    await friends(f3, mutual3);
    // Fastest S16 map clear, smaller first; two hidden players take places (and are never suggested).
    const veil1 = await someone('Veil', { publicProfile: false });
    const veil2 = await someone('Veil', { publicProfile: false });
    await record(boardFar, 'map_s16', 95_000);
    await record(veil1, 'map_s16', 96_000);
    await record(veil2, 'map_s16', 97_000);
    await record(three, 'map_s16', 98_000);
    await record(boardClose, 'map_s16', 99_000);
    await record(me, 'map_s16', 100_000);
    await record(two, 'map_s16', 101_000);
    await said(me, 60);
    await said(three, 55);
    await said(chatOnly, 50);

    const items = await listOf(me);
    expect(idsOf(items).slice(0, 7)).toEqual([
      three.id,
      two.id,
      mutual3.id,
      mutual1.id,
      boardClose.id,
      boardFar.id,
      chatOnly.id,
    ]);
    expect(items[0]?.reasons).toEqual([
      { kind: 'mutual', count: 1 },
      {
        kind: 'board',
        boardId: 'map_s16',
        boardTitle: 'Fastest S16 map clear',
        yourRank: 6,
        theirRank: 4,
      },
      { kind: 'chat' },
    ]);
    // Two reasons at most in the line.
    expect(items[0]?.note).toBe(
      '1 mutual friend · Near you on Fastest S16 map clear',
    );
    expect(items[1]?.note).toBe(
      '1 mutual friend · Near you on Fastest S16 map clear',
    );
    expect(items[4]?.reasons).toEqual([
      {
        kind: 'board',
        boardId: 'map_s16',
        boardTitle: 'Fastest S16 map clear',
        yourRank: 6,
        theirRank: 5,
      },
    ]);
    // After them, the fill: the recently active, nobody found otherwise.
    expect(
      items.slice(7).every((item) => item.reasons[0]?.kind === 'active'),
    ).toBe(true);
    expect(idsOf(items)).not.toContain(veil1.id);
  });

  it('writes the line from the two strongest reasons', () => {
    expect(noteOf([{ kind: 'mutual', count: 3 }])).toBe('3 mutual friends');
    expect(
      noteOf([
        { kind: 'mutual', count: 1 },
        { kind: 'chat' },
        { kind: 'active' },
      ]),
    ).toBe('1 mutual friend · Chatted with you in Global');
    expect(noteOf([{ kind: 'active' }])).toBe('Played this week');
  });
});

describe('dismissing', () => {
  it('hides a player for 30 days, answering 204', async () => {
    const me = await caller('Dot');
    const hub = await someone('Hub');
    const shown = await someone('Shown');
    const again = await someone('Again');
    await friends(me, hub);
    await friends(hub, shown, again);
    expect(idsOf(await listOf(me))).toContain(shown.id);

    const done = await dismiss(me, shown.id);
    expect(done.status).toBe(204);
    expect(done.body).toEqual({});
    // At once: the dismissal drops the cached list.
    expect(idsOf(await listOf(me))).not.toContain(shown.id);
    // Twice is fine, and starts the days over.
    expect((await dismiss(me, shown.id)).status).toBe(204);

    // A dismissal past 30 days hides nobody.
    expect((await dismiss(me, again.id)).status).toBe(204);
    await raw`UPDATE suggestion_dismissals SET dismissed_at = now() - interval '30 days 1 minute' WHERE user_id = ${me.id} AND dismissed_id = ${again.id}`;
    const ids = idsOf(await listOf(me));
    expect(ids).toContain(again.id);
    expect(ids).not.toContain(shown.id);
  });

  it('answers 400 for a malformed id and 404 for no such player, a guest, or the caller', async () => {
    const me = await caller('Ned');
    const visitor = await guest(base);
    expect((await dismiss(me, 'not-an-id')).status).toBe(400);
    for (const id of [crypto.randomUUID(), visitor.id, me.id]) {
      const reply = await dismiss(me, id);
      expect(reply.status).toBe(404);
      expect(reply.body.error).toBe('PLAYER_NOT_FOUND');
    }
  });

  it('is cleaned up daily at 04:50 once past 30 days, and goes with either account', async () => {
    const registry = started.app.get(ScheduleRegistry);
    expect(registry.get('suggestion-cleanup')).toMatchObject({
      kind: 'cron',
      at: '50 4 * * *',
    });
    const me = await caller('Ivy');
    const stale = await someone('Stale');
    const fresh = await someone('Fresh');
    const gone = await caller('Gone');
    await raw`INSERT INTO suggestion_dismissals (user_id, dismissed_id, dismissed_at) VALUES
      (${me.id}, ${stale.id}, now() - interval '31 days'),
      (${me.id}, ${fresh.id}, now() - interval '29 days'),
      (${me.id}, ${gone.id}, now()),
      (${gone.id}, ${me.id}, now())`;
    const rows = async () =>
      (
        (await raw`SELECT dismissed_id AS id FROM suggestion_dismissals WHERE user_id = ${me.id} OR dismissed_id = ${me.id}`) as {
          id: string;
        }[]
      )
        .map((row) => row.id)
        .sort();

    await registry.trigger('suggestion-cleanup');
    expect(await rows()).toEqual([fresh.id, gone.id, me.id].sort());

    const deleted = await call(base, 'POST', '/api/account/delete', {
      token: gone.token,
      body: { password: 'a long enough password' },
    });
    expect(deleted.status).toBe(200);
    expect(await rows()).toEqual([fresh.id]);
  });
});

describe('the dismissals table', () => {
  it('keeps one row per player and the one dismissed, never oneself', async () => {
    const a = await someone('Rowa');
    const b = await someone('Rowb');
    const refused = (work: Promise<unknown>) =>
      work.then(
        () => undefined,
        (error: unknown) => error,
      );
    await db
      .insert(suggestionDismissal)
      .values({ userId: a.id, dismissedId: b.id });
    expect(
      isUniqueViolation(
        await refused(
          db
            .insert(suggestionDismissal)
            .values({ userId: a.id, dismissedId: b.id }),
        ),
        'suggestion_dismissals_pkey',
      ),
    ).toBe(true);
    expect(
      checkViolation(
        await refused(
          db
            .insert(suggestionDismissal)
            .values({ userId: a.id, dismissedId: a.id }),
        ),
      ),
    ).toBe('suggestion_dismissals_not_self');
  });
});

describe('the cached list', () => {
  it('is kept five minutes, dropped by the friends routes, and never shows someone who may no longer be suggested', async () => {
    const me = await caller('Kai');
    const hub = await someone('Hub');
    await friends(me, hub);
    const first = await caller('First');
    await friends(hub, first);
    expect(idsOf(await listOf(me))).toContain(first.id);

    // Made behind the routes' back: the cached list does not know yet.
    const later = await someone('Later');
    await friends(hub, later);
    expect(idsOf(await listOf(me))).not.toContain(later.id);

    // A player who hides their profile leaves the list at once, though it is cached.
    expect(
      (
        await call(base, 'PATCH', '/api/profile', {
          token: first.token,
          body: { publicProfile: false },
        })
      ).status,
    ).toBe(200);
    expect(idsOf(await listOf(me))).not.toContain(first.id);

    // A friend request drops both lists.
    const other = await caller('Other');
    expect(
      (
        await call(base, 'POST', '/api/friends/requests', {
          token: me.token,
          body: { displayName: other.displayName },
        })
      ).status,
    ).toBe(200);
    const ids = idsOf(await listOf(me));
    expect(ids).toContain(later.id);
    expect(ids).not.toContain(other.id);
  });
});

describe('the routes', () => {
  it('refuse a guest with GUEST_ACCOUNT, and anyone without a session', async () => {
    const visitor = await guest(base);
    const read = await suggestions(visitor);
    expect(read.status).toBe(403);
    expect(read.body.error).toBe('GUEST_ACCOUNT');
    const someoneElse = await someone('Target');
    const hide = await dismiss(visitor, someoneElse.id);
    expect(hide.status).toBe(403);
    expect(hide.body.error).toBe('GUEST_ACCOUNT');
    expect((await call(base, 'GET', '/api/friends/suggestions')).status).toBe(
      401,
    );
  });

  it('take 60 reads an hour from one address, then answer 429', async () => {
    const me = await caller('Lim');
    const from = {
      'x-forwarded-for': `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    };
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++)
      statuses.push(
        (
          await call(base, 'GET', '/api/friends/suggestions', {
            token: me.token,
            headers: from,
          })
        ).status,
      );
    expect(statuses.slice(0, 60).every((status) => status === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
    // Every other read of this suite came from the test's own address, under the limit too.
    expect(reads).toBeLessThan(60);
  });
});
