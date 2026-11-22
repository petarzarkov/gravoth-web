import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ScheduleRegistry } from '@dunx/infra/schedule';
import type {
  AccountView,
  ChatMessageView,
  ChatModeratedMessages,
  ChatMuteList,
  ChatMuteView,
  ChatPage,
  ChatReportList,
  ChatReportView,
} from '@gravoth/contracts';
import { SQL } from 'bun';
import { startTestApp, type TestApp } from './testing/app.js';
import { call, signUp, type Player } from './testing/http.js';

/**
 * Decision 228's moderation (`/api/admin/chat`, the `admin` role, given by `bun run admin:grant`), the daily retention
 * job, and an account's chat going with it.
 */
let started: TestApp;
let base = '';
let db: SQL;
let mod: Player;
let ana: Player;
let bo: Player;
let cy: Player;
let dee: Player;

const get = <T>(path: string, who: Player) =>
  call<T>(base, 'GET', path, { token: who.token });
const post = <T>(path: string, who: Player, body: unknown = {}) =>
  call<T>(base, 'POST', path, { token: who.token, body });
const say = (who: Player, body: string) =>
  post<ChatMessageView>('/api/chat/global', who, { body });
const report = (who: Player, id: number, reason = 'spam', note?: string) =>
  post(`/api/chat/messages/${id}/report`, who, {
    reason,
    ...(note === undefined ? {} : { note }),
  });
const resolve = (id: number, body: unknown) =>
  post<ChatReportView & { error?: string }>(
    `/api/admin/chat/reports/${id}/resolve`,
    mod,
    body,
  );
const openReports = async () =>
  (await get<ChatReportList>('/api/admin/chat/reports', mod)).body.reports;

/** `bun run admin:grant|revoke <name>` against this suite's database. */
const adminRole = async (action: 'grant' | 'revoke', name: string) => {
  const child = Bun.spawn(['bun', 'scripts/admin-role.ts', action, name], {
    cwd: `${import.meta.dir}/..`,
    env: { ...Bun.env, DATABASE_URL: started.database.url },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, out: out.trim(), err: err.trim() };
};

beforeAll(async () => {
  started = await startTestApp();
  base = started.base;
  db = new SQL(started.database.url, { max: 1 });
  mod = await signUp(base, 'Warden', 'warden-mod@example.test');
  ana = await signUp(base, 'Ana', 'ana-mod@example.test');
  bo = await signUp(base, 'Bodil', 'bo-mod@example.test');
  cy = await signUp(base, 'Cyra', 'cy-mod@example.test');
  dee = await signUp(base, 'Deena', 'dee-mod@example.test');
  for (const who of [ana, bo, cy, dee])
    await post('/api/chat/rules/accept', who);
});

afterAll(async () => {
  await db.close();
  await started.close();
});

describe('the admin role', () => {
  it('is refused to every player without it, and to no session', async () => {
    for (const path of [
      '/api/admin/chat/reports',
      '/api/admin/chat/mutes',
      '/api/admin/chat/messages',
    ]) {
      expect((await get(path, ana)).status).toBe(403);
      expect((await call(base, 'GET', path)).status).toBe(401);
    }
    expect((await post('/api/admin/chat/messages/1/hide', ana)).status).toBe(
      403,
    );
    expect(
      (await post('/api/admin/chat/mutes', ana, { userId: bo.id, hours: 1 }))
        .status,
    ).toBe(403);
    expect((await get<AccountView>('/api/account', mod)).body.admin).toBe(
      false,
    );
  });

  it('is given and taken by the script, by display name in any case', async () => {
    const granted = await adminRole('grant', 'warden');
    expect(granted).toMatchObject({ code: 0 });
    expect(granted.out).toBe(`Warden (${mod.id}) is now an admin`);
    expect((await get<AccountView>('/api/account', mod)).body.admin).toBe(true);
    expect((await get('/api/admin/chat/reports', mod)).status).toBe(200);
    // Granting twice keeps one role; other roles stay.
    await db`UPDATE users SET role = 'tester' WHERE id = ${mod.id}`;
    await adminRole('grant', 'Warden');
    await adminRole('grant', 'Warden');
    expect(
      (
        (await db`SELECT role FROM users WHERE id = ${mod.id}`) as {
          role: string;
        }[]
      )[0]?.role,
    ).toBe('admin,tester');

    expect((await adminRole('revoke', 'Warden')).out).toBe(
      `Warden (${mod.id}) is no longer an admin`,
    );
    expect((await get('/api/admin/chat/reports', mod)).status).toBe(403);
    expect((await get<AccountView>('/api/account', ana)).body.admin).toBe(
      false,
    );
    const nobody = await adminRole('grant', 'Nobody99');
    expect([nobody.code, nobody.err]).toEqual([
      1,
      'no player is named Nobody99',
    ]);
    expect((await adminRole('promote' as 'grant', 'Warden')).code).toBe(2);
    expect((await adminRole('grant', 'Warden')).code).toBe(0);
  });
});

/** The two messages Cyra is reported for. */
let spam: ChatMessageView;
let rude: ChatMessageView;

describe('reports', () => {
  it('list the open ones newest first, each with its copy of the message and how many reported it', async () => {
    spam = (await say(cy, 'cheap gold, spam spam')).body;
    for (const who of [ana, bo, dee])
      await report(who, spam.id, 'spam', 'gold');
    rude = (await say(cy, 'you are all bad')).body;
    await report(ana, rude.id, 'harassment');

    const reports = await openReports();
    expect(
      reports.map((entry) => [entry.message.id, entry.reporter.userId]),
    ).toEqual([
      [rude.id, ana.id],
      [spam.id, dee.id],
      [spam.id, bo.id],
      [spam.id, ana.id],
    ]);
    expect(reports[1]).toMatchObject({
      reason: 'spam',
      note: 'gold',
      reporter: { displayName: 'Deena' },
      message: {
        id: spam.id,
        channel: 'global',
        from: { userId: cy.id, displayName: 'Cyra' },
        to: null,
        body: 'cheap gold, spam spam',
        at: spam.at,
        hidden: true,
      },
      reports: 3,
      resolved: null,
    });
    expect(reports[0]).toMatchObject({
      reports: 1,
      message: { hidden: false },
    });
    const page = await get<ChatReportList>(
      `/api/admin/chat/reports?take=2&before=${reports[1]?.id}`,
      mod,
    );
    expect(page.body.reports.map((entry) => entry.reporter.userId)).toEqual([
      bo.id,
      ana.id,
    ]);
    expect(
      (await get<ChatReportList>('/api/admin/chat/reports?state=closed', mod))
        .body.reports,
    ).toEqual([]);
  });

  it('dismissed, show the message again and close every open report of it', async () => {
    const [one] = (await openReports()).filter(
      (entry) => entry.message.id === spam.id,
    );
    const dismissed = await resolve(one?.id ?? 0, { action: 'dismiss' });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body).toMatchObject({
      message: { hidden: false },
      resolved: { action: 'dismiss', by: 'Warden' },
    });
    expect((await openReports()).map((entry) => entry.message.id)).toEqual([
      rude.id,
    ]);
    const closed = (
      await get<ChatReportList>('/api/admin/chat/reports?state=closed', mod)
    ).body.reports;
    expect(closed).toHaveLength(3);
    expect(closed.every((entry) => entry.resolved?.action === 'dismiss')).toBe(
      true,
    );
    expect(
      (await get<ChatPage>('/api/chat/global', ana)).body.messages.map(
        (message) => message.id,
      ),
    ).toContain(spam.id);
    // Reported again after a look, it takes three new reports to hide it.
    const fresh = await signUp(base, 'Fresh', 'fresh-mod@example.test');
    expect((await report(fresh, spam.id)).status).toBe(200);
    expect(
      (
        (await db`SELECT hidden_at FROM chat_messages WHERE id = ${spam.id}`) as {
          hidden_at: Date | null;
        }[]
      )[0]?.hidden_at,
    ).toBeNull();
  });

  it('hidden, take the message out for everyone and keep it for the moderator', async () => {
    const [entry] = await openReports();
    expect(entry?.message.id).toBe(spam.id);
    const hidden = await resolve(entry?.id ?? 0, { action: 'hide' });
    expect(hidden.body).toMatchObject({
      message: { hidden: true },
      resolved: { action: 'hide' },
    });
    const page = await get<ChatPage>('/api/chat/global', bo);
    expect(page.body.messages.map((message) => message.id)).not.toContain(
      spam.id,
    );
    expect(page.body.removed).toContain(spam.id);
    expect(
      (
        (await db`SELECT hidden_by FROM chat_messages WHERE id = ${spam.id}`) as {
          hidden_by: string;
        }[]
      )[0]?.hidden_by,
    ).toBe('moderator');
    expect((await resolve(99_999_999, { action: 'hide' })).body.error).toBe(
      'REPORT_NOT_FOUND',
    );
  });

  it('muting, need the hours, and stop the writer in every channel until it ends', async () => {
    const [entry] = await openReports();
    expect(entry?.message.id).toBe(rude.id);
    expect((await resolve(entry?.id ?? 0, { action: 'mute' })).status).toBe(
      400,
    );
    const muted = await resolve(entry?.id ?? 0, {
      action: 'mute',
      hours: 24,
      reason: 'harassment',
    });
    expect(muted.body).toMatchObject({
      message: { hidden: true },
      resolved: { action: 'mute' },
    });

    const refused = await call<{
      error: string;
      until: string;
      reason: string;
    }>(base, 'POST', '/api/chat/global', {
      token: cy.token,
      body: { body: 'let me talk' },
    });
    expect([refused.status, refused.body.error, refused.body.reason]).toEqual([
      403,
      'CHAT_MUTED',
      'harassment',
    ]);
    const until = Date.parse(refused.body.until);
    expect(until).toBeGreaterThan(Date.now() + 23.9 * 3_600_000);
    expect(until).toBeLessThan(Date.now() + 24.1 * 3_600_000);
    expect((await get<ChatPage>('/api/chat/global', cy)).body.muted).toEqual({
      until: refused.body.until,
      reason: 'harassment',
    });
    expect(
      (await get<ChatPage>('/api/chat/global', ana)).body.muted,
    ).toBeNull();

    const mutes = (await get<ChatMuteList>('/api/admin/chat/mutes', mod)).body
      .mutes;
    expect(mutes).toEqual([
      {
        player: expect.objectContaining({ userId: cy.id, displayName: 'Cyra' }),
        until: refused.body.until,
        reason: 'harassment',
        createdAt: expect.any(String),
      },
    ]);
    expect(
      (await post(`/api/admin/chat/mutes/${cy.id}/remove`, mod)).body,
    ).toEqual({ removed: true });
    expect((await say(cy, 'thank you')).status).toBe(200);
    const again = await post<{ error: string }>(
      `/api/admin/chat/mutes/${cy.id}/remove`,
      mod,
    );
    expect([again.status, again.body.error]).toEqual([404, 'MUTE_NOT_FOUND']);
  });

  it('stay readable, with their copy, once the message itself is gone', async () => {
    await db`DELETE FROM chat_messages WHERE id = ${rude.id}`;
    const kept = (
      await get<ChatReportList>('/api/admin/chat/reports?state=closed', mod)
    ).body.reports.find((entry) => entry.message.id === rude.id);
    expect(kept).toMatchObject({
      message: { id: rude.id, body: 'you are all bad', hidden: false },
      resolved: { action: 'mute' },
    });
  });
});

describe('mutes and messages', () => {
  it('mutes a player for a while from the admin page, and replaces a mute in force', async () => {
    const muted = await post<ChatMuteView>('/api/admin/chat/mutes', mod, {
      userId: dee.id,
      hours: 1,
      reason: 'flooding',
    });
    expect(muted.status).toBe(200);
    expect(muted.body).toMatchObject({
      player: { userId: dee.id },
      reason: 'flooding',
    });
    const longer = await post<ChatMuteView>('/api/admin/chat/mutes', mod, {
      userId: dee.id,
      hours: 87_600,
    });
    expect(Date.parse(longer.body.until)).toBeGreaterThan(
      Date.now() + 9 * 365 * 86_400_000,
    );
    expect(longer.body.reason).toBe('');
    expect(
      (await get<ChatMuteList>('/api/admin/chat/mutes', mod)).body.mutes.map(
        (entry) => entry.player.userId,
      ),
    ).toEqual([dee.id]);
    const unknown = await post<{ error: string }>(
      '/api/admin/chat/mutes',
      mod,
      {
        userId: '00000000-0000-4000-8000-000000000000',
        hours: 1,
      },
    );
    expect([unknown.status, unknown.body.error]).toEqual([
      404,
      'PLAYER_NOT_FOUND',
    ]);
    expect(
      (await post('/api/admin/chat/mutes', mod, { userId: dee.id, hours: 0 }))
        .status,
    ).toBe(400);
    // Ended, it no longer holds or shows.
    await db`UPDATE chat_mutes SET created_at = now() - interval '2 hours', until = now() - interval '1 hour' WHERE user_id = ${dee.id}`;
    expect((await say(dee, 'free again')).status).toBe(200);
    expect(
      (await get<ChatMuteList>('/api/admin/chat/mutes', mod)).body.mutes,
    ).toEqual([]);
  });

  it("reads the global channel, a player's messages and a pair's conversation, hidden ones too", async () => {
    const asked = await post<{ request: { id: string } }>(
      '/api/friends/requests',
      ana,
      { displayName: 'Bodil' },
    );
    await post(`/api/friends/requests/${asked.body.request.id}/accept`, bo);
    const ids: number[] = [];
    for (const [from, to, text] of [
      [ana, bo, 'a to b'],
      [bo, ana, 'b to a'],
      [ana, undefined, 'ana in global'],
      [ana, bo, 'a to b again'],
    ] as const)
      ids.push(
        (
          await post<ChatMessageView>(
            to === undefined ? '/api/chat/global' : `/api/chat/direct/${to.id}`,
            from,
            { body: text },
          )
        ).body.id,
      );

    const all = (
      await get<ChatModeratedMessages>('/api/admin/chat/messages', mod)
    ).body.messages;
    expect(all.every((message) => message.channel === 'global')).toBe(true);
    expect(all.map((message) => message.body)).toContain(
      'cheap gold, spam spam',
    );
    expect(all.find((message) => message.id === spam.id)?.hidden).toBe(true);

    const anas = (
      await get<ChatModeratedMessages>(
        `/api/admin/chat/messages?userId=${ana.id}`,
        mod,
      )
    ).body.messages;
    expect(anas.map((message) => message.body)).toEqual([
      'a to b',
      'ana in global',
      'a to b again',
    ]);
    expect(anas[0]).toMatchObject({
      channel: 'direct',
      from: { userId: ana.id },
      to: { userId: bo.id, displayName: 'Bodil' },
    });

    const pair = (
      await get<ChatModeratedMessages>(
        `/api/admin/chat/messages?userId=${ana.id}&peerId=${bo.id}`,
        mod,
      )
    ).body.messages;
    expect(pair.map((message) => message.body)).toEqual([
      'a to b',
      'b to a',
      'a to b again',
    ]);
    const around = (
      await get<ChatModeratedMessages>(
        `/api/admin/chat/messages?userId=${ana.id}&peerId=${bo.id}&around=${ids[1]}&take=2`,
        mod,
      )
    ).body.messages;
    expect(around.map((message) => message.id)).toEqual([ids[1]!, ids[3]!]);
    const before = (
      await get<ChatModeratedMessages>(
        `/api/admin/chat/messages?userId=${ana.id}&before=${ids[3]}&take=1`,
        mod,
      )
    ).body.messages;
    expect(before.map((message) => message.id)).toEqual([ids[2]!]);
  });

  it('hides any message from the admin page', async () => {
    const message = (await say(bo, 'something to hide')).body;
    const hidden = await post<{ hidden: boolean; body: string }>(
      `/api/admin/chat/messages/${message.id}/hide`,
      mod,
    );
    expect(hidden.body).toMatchObject({
      hidden: true,
      body: 'something to hide',
    });
    expect(
      (await get<ChatPage>('/api/chat/global', ana)).body.removed,
    ).toContain(message.id);
    const missing = await post<{ error: string }>(
      '/api/admin/chat/messages/99999999/hide',
      mod,
    );
    expect([missing.status, missing.body.error]).toEqual([
      404,
      'MESSAGE_NOT_FOUND',
    ]);
  });
});

describe('retention', () => {
  it('is armed daily at 04:45, after the backup and the guest clean-up', () => {
    expect(
      started.app.get(ScheduleRegistry).get('chat-retention'),
    ).toMatchObject({ kind: 'cron', at: '45 4 * * *' });
  });

  it('deletes messages after 30 days unless an open report holds them, closed reports after 180, and ended mutes', async () => {
    const old = (await say(bo, 'an old message')).body;
    const held = (await say(cy, 'an old reported one')).body;
    const recent = (await say(cy, 'a recent one')).body;
    await report(ana, held.id, 'hate');
    await db`UPDATE chat_messages SET created_at = now() - interval '31 days' WHERE id IN (${old.id}, ${held.id})`;
    const [closedOld] = (await db`
      SELECT id FROM chat_reports WHERE resolved_at IS NOT NULL ORDER BY id LIMIT 1`) as {
      id: string;
    }[];
    await db`UPDATE chat_reports SET resolved_at = now() - interval '181 days' WHERE id = ${closedOld?.id}`;
    await db`INSERT INTO chat_mutes (user_id, until, created_at) VALUES (${bo.id}, now() - interval '1 minute', now() - interval '1 hour')`;

    await started.app.get(ScheduleRegistry).trigger('chat-retention');

    const left = (await db`SELECT id FROM chat_messages`) as { id: string }[];
    const ids = left.map((row) => Number(row.id));
    expect(ids).not.toContain(old.id);
    expect(ids).toContain(held.id);
    expect(ids).toContain(recent.id);
    expect(
      (
        (await db`SELECT count(*)::int AS n FROM chat_reports WHERE id = ${closedOld?.id}`) as {
          n: number;
        }[]
      )[0]?.n,
    ).toBe(0);
    expect(
      (
        (await db`SELECT count(*)::int AS n FROM chat_reports`) as {
          n: number;
        }[]
      )[0]?.n,
    ).toBeGreaterThan(0);
    expect(
      (
        (await db`SELECT count(*)::int AS n FROM chat_mutes WHERE user_id = ${bo.id}`) as {
          n: number;
        }[]
      )[0]?.n,
    ).toBe(0);

    // Closed, the report lets its message go at the next run.
    const [open] = (await openReports()).filter(
      (entry) => entry.message.id === held.id,
    );
    await resolve(open?.id ?? 0, { action: 'dismiss' });
    await started.app.get(ScheduleRegistry).trigger('chat-retention');
    expect(
      (
        (await db`SELECT count(*)::int AS n FROM chat_messages WHERE id = ${held.id}`) as {
          n: number;
        }[]
      )[0]?.n,
    ).toBe(0);
  });
});

describe('deleting an account', () => {
  it('takes its messages, read marks, reports by and about it, and its mute', async () => {
    const asked = await post<{ request: { id: string } }>(
      '/api/friends/requests',
      cy,
      { displayName: 'Deena' },
    );
    await post(`/api/friends/requests/${asked.body.request.id}/accept`, dee);
    await db`UPDATE chat_messages SET created_at = created_at - interval '2 minutes'`;
    const dm = (
      await post<ChatMessageView>(`/api/chat/direct/${dee.id}`, cy, {
        body: 'hi dee',
      })
    ).body;
    await post(`/api/chat/direct/${cy.id}/read`, dee, { upTo: dm.id });
    await report(dee, dm.id, 'harassment');
    const theirs = (await say(dee, 'dee in global')).body;
    await report(cy, theirs.id, 'spam');
    await post('/api/admin/chat/mutes', mod, { userId: cy.id, hours: 1 });

    expect(
      (
        await call(base, 'POST', '/api/account/delete', {
          token: cy.token,
          body: { password: 'a long enough password' },
        })
      ).status,
    ).toBe(200);
    const [left] = (await db`
      SELECT (SELECT count(*)::int FROM chat_messages WHERE sender_id = ${cy.id} OR recipient_id = ${cy.id}) AS messages,
             (SELECT count(*)::int FROM chat_reads WHERE user_id = ${cy.id} OR peer_id = ${cy.id}) AS reads,
             (SELECT count(*)::int FROM chat_reports WHERE reporter_id = ${cy.id} OR sender_id = ${cy.id} OR recipient_id = ${cy.id}) AS reports,
             (SELECT count(*)::int FROM chat_mutes WHERE user_id = ${cy.id}) AS mutes`) as {
      messages: number;
      reads: number;
      reports: number;
      mutes: number;
    }[];
    expect(left).toEqual({ messages: 0, reads: 0, reports: 0, mutes: 0 });
    // The others' own messages stay.
    expect(
      (
        (await db`SELECT count(*)::int AS n FROM chat_messages WHERE id = ${theirs.id}`) as {
          n: number;
        }[]
      )[0]?.n,
    ).toBe(1);
  });
});
