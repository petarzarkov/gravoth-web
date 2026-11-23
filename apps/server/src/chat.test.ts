import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  CHAT_LIMITS,
  type ChatConversations,
  type ChatMessageView,
  type ChatPage,
  type ChatUnread,
} from '@gravoth/contracts';
import { SQL } from 'bun';
import { filterMessage } from './chat/chat-filter.js';
import { startTestApp, type TestApp } from './testing/app.js';
import { call, guest, signUp, type Player } from './testing/http.js';

/**
 * Chat (decision 228) as the game calls it: the rules, the filter, the flood and repeat limits, the global channel's
 * pages (`after`, `before`, `gap`, `removed`), friends' direct messages, read marks and the unread badge, blocks and
 * reports. Moderation, retention and deletion are chat-moderation.test.ts's.
 */
let started: TestApp;
let base = '';
let db: SQL;
let ana: Player;
let bo: Player;
let cy: Player;
let dee: Player;

const get = <T>(path: string, who: Player) =>
  call<T>(base, 'GET', path, { token: who.token });
const post = <T>(path: string, who: Player, body: unknown = {}) =>
  call<T>(base, 'POST', path, { token: who.token, body });
const say = (who: Player, body: string) =>
  post<ChatMessageView & { error?: string }>('/api/chat/global', who, {
    body,
  });
const whisper = (who: Player, to: Player, body: string) =>
  post<ChatMessageView & { error?: string }>(`/api/chat/direct/${to.id}`, who, {
    body,
  });
const globalPage = (who: Player, query = '') =>
  get<ChatPage>(`/api/chat/global${query}`, who);

/** A player's messages made `seconds` older, as the flood and repeat windows would see them later. */
const age = (who: Player, seconds: number) =>
  db`UPDATE chat_messages SET created_at = created_at - make_interval(secs => ${seconds}) WHERE sender_id = ${who.id}`;

const befriend = async (a: Player, b: Player) => {
  const asked = await post<{ request: { id: string } }>(
    '/api/friends/requests',
    a,
    { displayName: b.displayName },
  );
  expect(asked.status).toBe(200);
  expect(
    (await post(`/api/friends/requests/${asked.body.request.id}/accept`, b))
      .status,
  ).toBe(200);
};

beforeAll(async () => {
  started = await startTestApp();
  base = started.base;
  db = new SQL(started.database.url, { max: 1 });
  ana = await signUp(base, 'Ana', 'ana-chat@example.test');
  bo = await signUp(base, 'Bodil', 'bo-chat@example.test');
  cy = await signUp(base, 'Cyra', 'cy-chat@example.test');
  dee = await signUp(base, 'Deena', 'dee-chat@example.test');
});

afterAll(async () => {
  await db.close();
  await started.close();
});

describe('the filter', () => {
  const stored = (text: string) => {
    const outcome = filterMessage(text);
    return outcome.ok ? outcome.body : outcome.code;
  };

  it('masks the bad-words list letter for letter, whole words in any case (decision 229)', () => {
    expect(stored('what the fuck')).toBe('what the ****');
    expect(stored('SHIT happens!')).toBe('**** happens!');
    expect(stored('you retard')).toBe('you ******');
    expect(stored('Fuck_you')).toBe('****_you');
    expect(stored('f​uck')).toBe('****');
  });

  it("lets ordinary words through, those that hold a listed one and the world's own", () => {
    for (const text of [
      'Assassin build is great',
      'I love grape juice',
      'cocktail of class and analysis',
      'Scunthorpe United, my therapist',
      'the God of the Pit, one hell of a fight, damn',
      'Long sword at lvl.70, v0.13.0',
      'e.g. Mr.Smith said ok.so',
    ])
      expect(stored(text)).toBe(text);
  });

  it('refuses an empty message', () => {
    expect(stored('​​')).toBe('MESSAGE_NOT_ALLOWED');
  });

  it('refuses every link but the website, bare domains too', () => {
    for (const text of [
      'evil.com',
      'see www.evil',
      'http://x.y',
      'discord.gg/abc',
      'bit.ly/x',
      'mail a@gmail.com',
      'me@mail.co',
      'evil.to/x',
      'javascript:alert(1)',
      'https://gravoth.petarzarkov.com.evil.com',
      'https://gravoth.petarzarkov.com@evil.com/',
      'https://petarzarkov.com',
    ])
      expect(stored(text)).toBe('LINKS_NOT_ALLOWED');
    for (const text of [
      'my build https://gravoth.petarzarkov.com/builds/1f0c-aa',
      'gravoth.petarzarkov.com/players/1f0c',
      'HTTPS://GRAVOTH.PETARZARKOV.COM/',
      'hello.world and i.am here',
    ])
      expect(stored(text)).toBe(text);
  });

  it('reads a dodged dot as a dot in a link', () => {
    for (const text of ['evil . com', 'go to evil(.)com', 'evil [ . ] gg/abc'])
      expect(stored(text)).toBe('LINKS_NOT_ALLOWED');
    for (const text of [
      'done. Club tonight',
      'gg. win next time',
      'nice . me too',
    ])
      expect(stored(text)).toBe(text);
  });

  it('keeps one line of text', () => {
    expect(stored('  a\nb\tc  ')).toBe('a b c');
  });
});

describe('the rules', () => {
  it('come before the first message, once, on the server', async () => {
    const page = await globalPage(ana);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({
      messages: [],
      gap: false,
      removed: [],
      muted: null,
      rulesAccepted: false,
    });
    const refused = await say(ana, 'hello');
    expect([refused.status, refused.body.error]).toEqual([403, 'CHAT_RULES']);

    for (const who of [ana, bo, cy, dee])
      expect((await post('/api/chat/rules/accept', who)).body).toEqual({
        accepted: true,
      });
    const [first] = (await db`
      SELECT chat_rules_at FROM profiles WHERE user_id = ${ana.id}`) as {
      chat_rules_at: Date;
    }[];
    await post('/api/chat/rules/accept', ana);
    const [again] = (await db`
      SELECT chat_rules_at FROM profiles WHERE user_id = ${ana.id}`) as {
      chat_rules_at: Date;
    }[];
    expect(again?.chat_rules_at.getTime()).toBe(first?.chat_rules_at.getTime());
    expect((await globalPage(ana)).body.rulesAccepted).toBe(true);
  });

  it("are an account's: a guest has no chat at all, and no session is a 401", async () => {
    const visitor = await guest(base);
    const replies: { status: number; body: unknown }[] = [
      await globalPage(visitor),
      await say(visitor, 'hi'),
      await get('/api/chat/direct', visitor),
      await get(`/api/chat/direct/${ana.id}`, visitor),
      await get('/api/chat/unread', visitor),
      await post('/api/chat/rules/accept', visitor),
      await post('/api/chat/messages/1/report', visitor, { reason: 'spam' }),
      await post(`/api/chat/direct/${ana.id}/read`, visitor, { upTo: 1 }),
    ];
    for (const reply of replies)
      expect([reply.status, (reply.body as { error?: string }).error]).toEqual([
        403,
        'GUEST_ACCOUNT',
      ]);
    expect((await call(base, 'GET', '/api/chat/global')).status).toBe(401);
  });
});

describe('the global channel', () => {
  let first: ChatMessageView;

  it('stores a message as the filter left it, and answers it', async () => {
    const sent = await say(ana, '  hello, what the fuck  ');
    expect(sent.status).toBe(200);
    first = sent.body;
    expect(first).toMatchObject({
      channel: 'global',
      from: { userId: ana.id, displayName: 'Ana' },
      body: 'hello, what the ****',
      mine: true,
    });
    expect(first.from.avatar.kind).toBe('portrait');
    expect(Date.parse(first.at)).toBeGreaterThan(Date.now() - 60_000);

    const link = await say(ana, 'free gold at evil.com');
    expect([link.status, link.body.error]).toEqual([422, 'LINKS_NOT_ALLOWED']);
    const site = await say(
      ana,
      'my build: https://gravoth.petarzarkov.com/builds/abc',
    );
    expect(site.status).toBe(200);
    const long = await say(ana, 'x'.repeat(CHAT_LIMITS.MAX_BODY + 1));
    expect(long.status).toBe(400);
  });

  it('reads oldest first, polls after an id, and scrolls back before one', async () => {
    const page = await globalPage(bo);
    const texts = page.body.messages.map((message) => message.body);
    expect(texts).toEqual([
      'hello, what the ****',
      'my build: https://gravoth.petarzarkov.com/builds/abc',
    ]);
    expect(page.body.messages[0]?.mine).toBe(false);
    const newest = page.body.messages.at(-1)?.id ?? 0;

    expect((await globalPage(bo, `?after=${newest}`)).body).toMatchObject({
      messages: [],
      gap: false,
    });
    const one = await say(bo, 'one');
    const two = await say(cy, 'two');
    const three = await say(dee, 'three');
    const poll = await globalPage(bo, `?after=${newest}`);
    expect(poll.body.messages.map((message) => message.body)).toEqual([
      'one',
      'two',
      'three',
    ]);
    expect(poll.body.messages.map((message) => message.mine)).toEqual([
      true,
      false,
      false,
    ]);

    // More new ones than the page holds: the newest, and a gap.
    const gapped = await globalPage(bo, `?after=${newest}&take=2`);
    expect(gapped.body.messages.map((message) => message.id)).toEqual([
      two.body.id,
      three.body.id,
    ]);
    expect(gapped.body.gap).toBe(true);
    expect(
      (await globalPage(bo, `?after=${one.body.id}&take=2`)).body.gap,
    ).toBe(false);

    const back = await globalPage(bo, `?before=${three.body.id}&take=2`);
    expect(back.body.messages.map((message) => message.id)).toEqual([
      one.body.id,
      two.body.id,
    ]);
    expect(back.body.gap).toBe(false);
    expect((await globalPage(bo, `?before=${first.id}`)).body.messages).toEqual(
      [],
    );
    expect((await globalPage(bo, '?take=101')).status).toBe(400);
  });

  it('refuses the same text again within 30 seconds, then takes it', async () => {
    await age(cy, 120);
    expect((await say(cy, 'gg all')).status).toBe(200);
    const again = await say(cy, '  GG   all ');
    expect([again.status, again.body.error]).toEqual([409, 'CHAT_REPEAT']);
    // Another text is fine, and only the last message counts.
    expect((await say(cy, 'gg everyone')).status).toBe(200);
    expect((await say(cy, 'gg all')).status).toBe(200);
    await age(cy, CHAT_LIMITS.REPEAT_SECONDS + 1);
    expect((await say(cy, 'gg all')).status).toBe(200);
  });

  it('takes ten messages a minute from a player, both channels together, wherever they come from', async () => {
    await befriend(dee, bo);
    await age(dee, 120);
    await age(bo, 120);
    for (let n = 1; n <= 6; n++)
      expect((await say(dee, `global ${n}`)).status).toBe(200);
    for (let n = 1; n <= 4; n++)
      expect((await whisper(dee, bo, `direct ${n}`)).status).toBe(200);
    const flood = await call<{ error: string }>(
      base,
      'POST',
      '/api/chat/global',
      { token: dee.token, body: { body: 'one more' } },
    );
    expect([flood.status, flood.body.error]).toEqual([
      429,
      'TOO_MANY_REQUESTS',
    ]);
    const retry = await fetch(`${base}/api/chat/global`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${dee.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ body: 'and another' }),
    });
    expect(retry.status).toBe(429);
    const after = Number(retry.headers.get('retry-after'));
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(60);
    expect((await whisper(dee, bo, 'direct 5')).status).toBe(429);
    // Another player on the same address is not held up.
    expect((await say(bo, 'still here')).status).toBe(200);
    // A minute on, the window has room again.
    await age(dee, 61);
    expect((await say(dee, 'one more')).status).toBe(200);
  });
});

describe('direct messages', () => {
  it('go to friends only, and each conversation is its own channel', async () => {
    const stranger = await whisper(ana, cy, 'hi');
    expect([stranger.status, stranger.body.error]).toEqual([
      403,
      'NOT_FRIENDS',
    ]);
    const nobody = await post<{ error: string }>(
      '/api/chat/direct/00000000-0000-4000-8000-000000000000',
      ana,
      { body: 'hi' },
    );
    expect([nobody.status, nobody.body.error]).toEqual([403, 'NOT_FRIENDS']);
    expect((await whisper(ana, ana, 'me')).body.error).toBe('NOT_FRIENDS');

    await befriend(ana, cy);
    await befriend(ana, bo);
    const sent = await whisper(ana, cy, 'hi cy');
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({
      channel: 'direct',
      from: { userId: ana.id },
      body: 'hi cy',
      mine: true,
    });
    expect((await whisper(ana, bo, 'hi cy')).status).toBe(200);
    expect((await whisper(cy, ana, 'hi ana, fuck yes')).body.body).toBe(
      'hi ana, **** yes',
    );

    const mine = await get<ChatPage>(`/api/chat/direct/${cy.id}`, ana);
    expect(
      mine.body.messages.map((message) => [message.body, message.mine]),
    ).toEqual([
      ['hi cy', true],
      ['hi ana, **** yes', false],
    ]);
    const theirs = await get<ChatPage>(`/api/chat/direct/${ana.id}`, cy);
    expect(theirs.body.messages.map((message) => message.mine)).toEqual([
      false,
      true,
    ]);
    // Nobody else's conversation shows in it, and the global channel holds none of it.
    expect(
      (await get<ChatPage>(`/api/chat/direct/${ana.id}`, dee)).body.messages,
    ).toEqual([]);
    expect(
      (await globalPage(dee)).body.messages.some((message) =>
        message.body.startsWith('hi cy'),
      ),
    ).toBe(false);
    expect(
      (await get(`/api/chat/direct/00000000-0000-4000-8000-000000000000`, ana))
        .status,
    ).toBe(404);
    expect((await get(`/api/chat/direct/${ana.id}`, ana)).status).toBe(404);
  });

  it('count unread per friend until read, and a read mark never runs ahead', async () => {
    await age(cy, 120);
    const sent: number[] = [];
    for (const text of ['one', 'two', 'three'])
      sent.push((await whisper(cy, ana, `unread ${text}`)).body.id);
    const unread = (await get<ChatUnread>('/api/chat/unread', ana)).body;
    expect(unread).toEqual({
      direct: 4,
      from: [{ userId: cy.id, count: 4 }],
    });
    // Cyra's own are not unread to her; Ana's one to her is.
    expect((await get<ChatUnread>('/api/chat/unread', cy)).body).toEqual({
      direct: 1,
      from: [{ userId: ana.id, count: 1 }],
    });

    expect(
      (await post(`/api/chat/direct/${cy.id}/read`, ana, { upTo: sent[1] }))
        .body,
    ).toEqual({ read: true });
    expect((await get<ChatUnread>('/api/chat/unread', ana)).body.direct).toBe(
      1,
    );
    // An older mark does not move it back.
    await post(`/api/chat/direct/${cy.id}/read`, ana, { upTo: 1 });
    expect((await get<ChatUnread>('/api/chat/unread', ana)).body.direct).toBe(
      1,
    );
    // Past the newest message: held at the newest, so the next one is unread.
    await post(`/api/chat/direct/${cy.id}/read`, ana, { upTo: 10_000_000 });
    expect((await get<ChatUnread>('/api/chat/unread', ana)).body.direct).toBe(
      0,
    );
    await whisper(cy, ana, 'after the mark');
    expect((await get<ChatUnread>('/api/chat/unread', ana)).body).toEqual({
      direct: 1,
      from: [{ userId: cy.id, count: 1 }],
    });
    expect(
      (await post(`/api/chat/direct/${dee.id}/read`, ana, { upTo: -1 })).status,
    ).toBe(400);
  });

  it('list the conversations newest first, each with its last line and unread count', async () => {
    await whisper(bo, ana, 'bo was here');
    const list = (await get<ChatConversations>('/api/chat/direct', ana)).body
      .conversations;
    expect(list.map((entry) => entry.peer.userId)).toEqual([bo.id, cy.id]);
    expect(list[0]).toMatchObject({
      peer: { userId: bo.id, displayName: 'Bodil' },
      last: { body: 'bo was here', mine: false },
      unread: 1,
    });
    expect(list[1]).toMatchObject({
      last: { body: 'after the mark' },
      unread: 1,
    });
    expect(
      (
        await get<ChatConversations>('/api/chat/direct', dee)
      ).body.conversations.map((entry) => entry.peer.userId),
    ).toEqual([bo.id]);
  });

  it('stay readable to both once the friendship ends, and take no more', async () => {
    expect((await post(`/api/friends/${bo.id}/remove`, ana)).status).toBe(200);
    const ended = await whisper(bo, ana, 'still friends?');
    expect([ended.status, ended.body.error]).toEqual([403, 'NOT_FRIENDS']);
    expect(
      (await get<ChatPage>(`/api/chat/direct/${bo.id}`, ana)).body.messages.map(
        (message) => message.body,
      ),
    ).toEqual(['hi cy', 'bo was here']);
    expect(
      (
        await get<ChatConversations>('/api/chat/direct', bo)
      ).body.conversations.some((entry) => entry.peer.userId === ana.id),
    ).toBe(true);
  });
});

describe('blocks', () => {
  it("hide a blocked player's messages from the blocker only, and end their direct messages", async () => {
    await age(cy, 120);
    const loud = await say(cy, 'cy speaks');
    await whisper(cy, ana, 'cy whispers');
    expect(
      (await post('/api/blocks', ana, { displayName: 'Cyra' })).status,
    ).toBe(200);

    const seen = (who: Player) =>
      globalPage(who).then((page) =>
        page.body.messages.map((message) => message.id),
      );
    expect(await seen(ana)).not.toContain(loud.body.id);
    expect(await seen(bo)).toContain(loud.body.id);
    // Her own messages to Cyra stay hers to read; Cyra's to her go, from the list, the page and the badge.
    expect(
      (await get<ChatPage>(`/api/chat/direct/${cy.id}`, ana)).body.messages.map(
        (message) => message.body,
      ),
    ).toEqual(['hi cy']);
    expect(
      (
        await get<ChatConversations>('/api/chat/direct', ana)
      ).body.conversations.map((entry) => entry.peer.userId),
    ).toEqual([bo.id]);
    expect(
      (await get<ChatUnread>('/api/chat/unread', ana)).body.from.map(
        (entry) => entry.userId,
      ),
    ).toEqual([bo.id]);
    // Blocking ended the friendship: neither may write to the other.
    expect((await whisper(cy, ana, 'hello?')).body.error).toBe('NOT_FRIENDS');
    expect((await whisper(ana, cy, 'bye')).body.error).toBe('NOT_FRIENDS');

    // Unblocked, her messages show again.
    expect((await post(`/api/blocks/${cy.id}/remove`, ana)).status).toBe(200);
    expect(await seen(ana)).toContain(loud.body.id);
  });
});

describe('reports', () => {
  let target: ChatMessageView;

  it('take any message the player can see and did not write, once', async () => {
    await age(cy, 120);
    target = (await say(cy, 'buy gold cheap, spam spam')).body;
    const reported = await post(`/api/chat/messages/${target.id}/report`, ana, {
      reason: 'spam',
      note: 'selling gold',
    });
    expect([reported.status, reported.body]).toEqual([200, { reported: true }]);
    expect(
      (
        await post(`/api/chat/messages/${target.id}/report`, ana, {
          reason: 'harassment',
        })
      ).body,
    ).toEqual({ reported: true });
    const rows = (await db`
      SELECT reason, note, body, channel, sender_id, recipient_id FROM chat_reports
      WHERE message_id = ${target.id}`) as Record<string, unknown>[];
    expect(rows).toEqual([
      {
        reason: 'spam',
        note: 'selling gold',
        body: 'buy gold cheap, spam spam',
        channel: 'global',
        sender_id: cy.id,
        recipient_id: null,
      },
    ]);

    const own = await post<{ error: string }>(
      `/api/chat/messages/${target.id}/report`,
      cy,
      { reason: 'spam' },
    );
    expect([own.status, own.body.error]).toEqual([400, 'CANNOT_REPORT_SELF']);
    const missing = await post<{ error: string }>(
      '/api/chat/messages/99999999/report',
      ana,
      { reason: 'spam' },
    );
    expect([missing.status, missing.body.error]).toEqual([
      404,
      'MESSAGE_NOT_FOUND',
    ]);
    // Someone else's conversation is not the player's to see.
    const [direct] = (await db`
      SELECT id FROM chat_messages WHERE channel = 'direct' AND sender_id = ${cy.id} AND recipient_id = ${ana.id} LIMIT 1`) as {
      id: string;
    }[];
    const elsewhere = await post<{ error: string }>(
      `/api/chat/messages/${direct?.id}/report`,
      dee,
      { reason: 'harassment' },
    );
    expect([elsewhere.status, elsewhere.body.error]).toEqual([
      404,
      'MESSAGE_NOT_FOUND',
    ]);
    expect(
      (
        await post(`/api/chat/messages/${direct?.id}/report`, ana, {
          reason: 'harassment',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post(`/api/chat/messages/${target.id}/report`, ana, {
          reason: 'rude',
        })
      ).status,
    ).toBe(400);
  });

  it('hide a global message once three players report it, and list it as removed', async () => {
    expect(
      (
        await post(`/api/chat/messages/${target.id}/report`, bo, {
          reason: 'spam',
        })
      ).status,
    ).toBe(200);
    expect(
      (await globalPage(dee)).body.messages.map((message) => message.id),
    ).toContain(target.id);
    expect(
      (
        await post(`/api/chat/messages/${target.id}/report`, dee, {
          reason: 'spam',
        })
      ).status,
    ).toBe(200);

    const page = await globalPage(dee);
    expect(page.body.messages.map((message) => message.id)).not.toContain(
      target.id,
    );
    expect(page.body.removed).toContain(target.id);
    expect(
      (await globalPage(cy)).body.messages.map((message) => message.id),
    ).not.toContain(target.id);
    // Hidden, it can no longer be seen, so no longer reported.
    const late = await signUp(base, 'Late', 'late-chat@example.test');
    await post('/api/chat/rules/accept', late);
    expect(
      (
        await post(`/api/chat/messages/${target.id}/report`, late, {
          reason: 'spam',
        })
      ).status,
    ).toBe(404);
    const [hidden] = (await db`
      SELECT hidden_by FROM chat_messages WHERE id = ${target.id}`) as {
      hidden_by: string;
    }[];
    expect(hidden?.hidden_by).toBe('reports');
  });
});
