import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { provide } from '@dunx/core';
import type {
  BoardPage,
  PlayerPage,
  RealmLeaseView,
  RealmView,
  RealmWritten,
  SubmitResult,
} from '@gravoth/contracts';
import { SQL } from 'bun';
import { AppConfigService } from './config.js';
import {
  ValidatorClient,
  type CardPage,
  type HeroCheck,
  type HeroesReport,
  type RecordCheck,
  type SaveReport,
} from './gravoth/validator.client.js';
import { RealmSync } from './realm/realm-sync.js';
import { startTestApp, type TestApp } from './testing/app.js';
import { call, guest, signUp, type Player } from './testing/http.js';

/**
 * The online realm (decision 227) over HTTP, as the game calls it: the one-device lease (taken, renewed, refused,
 * forced, released, kept through a long drop), uploads at a revision, the size limit, the one-time transfer, and what
 * follows each accepted upload: the rules checker's read landed on the heroes (online, flagged), their builds and the
 * boards, which show online heroes only.
 *
 * The rules checker is a stand-in that reads a "save" written as JSON by the test: the heroes `/saves/heroes` answers
 * and the level each one's snapshot has (the real one reads the game's save with its Core; e2e/ drives that).
 */
let snapshotsAsked = 0;
let checkerDown = false;
class StandInValidator extends ValidatorClient {
  override async up(): Promise<boolean> {
    return true;
  }
  override async check(save: string): Promise<SaveReport> {
    return JSON.parse(save) as SaveReport;
  }
  override async heroes(save: string): Promise<HeroesReport> {
    if (checkerDown) throw new Error('connection refused');
    if (save === 'garbage')
      return {
        ok: false,
        needsNewerBuild: false,
        needs: 0,
        warnings: ['unreadable'],
        saveId: null,
        heroes: [],
      };
    return {
      ok: true,
      needsNewerBuild: false,
      needs: 0,
      warnings: [],
      saveId: 'a1666a2c2290d9aa',
      heroes: (JSON.parse(save) as { heroes: HeroCheck[] }).heroes,
    };
  }
  override async snapshot(
    save: string,
    heroId: number,
    gameVersion: string,
  ): Promise<unknown> {
    snapshotsAsked += 1;
    const found = (JSON.parse(save) as { heroes: HeroCheck[] }).heroes.find(
      (h) => h.characterId === heroId,
    );
    if (found === undefined) return null;
    return {
      revision: 0,
      gameVersion,
      level: found.level,
      skills: [{ id: 'cleave', level: 10, slot: 0, supports: [] }],
      gear: [],
      talents: { allocated: [1, 2] },
      extras: { border: 'pit_30' },
      summary: { dps: 10, clearDps: 5, ehp: 100, life: 50 },
    };
  }
  override async card(_save: string, heroId: number): Promise<CardPage[]> {
    return [
      {
        title: 'Build',
        sections: [
          { title: 'Hero', rows: [{ label: 'id', value: `${heroId}` }] },
        ],
      },
    ];
  }
}

const record = (
  board: string,
  score: number,
  characterId: number,
  more: Partial<RecordCheck> = {},
): RecordCheck => ({
  board,
  score,
  characterId,
  witness: 'unchecked',
  plausible: true,
  ranked: true,
  ...more,
});

const heroOf = (
  characterId: number,
  name: string,
  level: number,
  more: Partial<HeroCheck> = {},
): HeroCheck => ({
  characterId,
  name,
  class: 'barbarian',
  level,
  hardcore: false,
  plausible: true,
  reasons: [],
  records: [],
  fingerprint: `${characterId}${name}`
    .split('')
    .map((ch) => ch.charCodeAt(0).toString(16))
    .join('')
    .padEnd(64, '0')
    .slice(0, 64),
  dps: 1_234,
  clearDps: 900,
  ehp: 10_000,
  life: 3_000,
  highestChartTier: 0,
  ...more,
});

/** A realm's bytes: the stand-in's JSON, base64. */
const realmOf = (...heroes: HeroCheck[]): string =>
  Buffer.from(JSON.stringify({ heroes })).toString('base64');

let started: TestApp;
let base = '';
let sql: SQL;
let sync: RealmSync;
let ana: Player;
let bo: Player;

const lease = (who: Player, deviceId: string, force?: boolean) =>
  call<RealmLeaseView & { error?: string }>(base, 'POST', '/api/realm/lease', {
    token: who.token,
    body: { deviceId, ...(force === undefined ? {} : { force }) },
  });
const put = (
  who: Player,
  body: Record<string, unknown>,
  headers: Record<string, string> = { 'x-gravoth-client': 'game/0.13.1' },
) =>
  call<
    RealmWritten & {
      error?: string;
      revision?: number;
      characterIds?: number[];
      leaseUntil?: string;
    }
  >(base, 'PUT', '/api/realm', { token: who.token, body, headers });
const read = (who: Player) =>
  call<RealmView & { error?: string }>(base, 'GET', '/api/realm', {
    token: who.token,
  });
/** An upload, and its checks waited for. */
const upload = async (
  who: Player,
  deviceId: string,
  baseRevision: number,
  data: string,
  more: Record<string, unknown> = {},
) => {
  const reply = await put(who, {
    deviceId,
    baseRevision,
    data,
    reason: 'checkpoint',
    ...more,
  });
  await sync.settled(who.id);
  return reply;
};
const board = async (key: string) =>
  (await call<BoardPage>(base, 'GET', `/api/leaderboards/${key}`)).body.entries
    .data;

beforeAll(async () => {
  started = await startTestApp({
    overrides: [
      provide(ValidatorClient, {
        useFactory: (config: AppConfigService) => new StandInValidator(config),
        inject: [AppConfigService],
      }),
    ],
  });
  base = started.base;
  sql = new SQL(started.database.url, { max: 1 });
  sync = started.app.get(RealmSync);
  ana = await signUp(base, 'Ana', 'ana@realm.test');
  bo = await signUp(base, 'Bodhi', 'bo@realm.test');
});

afterAll(async () => {
  await sql.close();
  await started.close();
});

describe('the lease', () => {
  it('is taken by the first device, renewed by it, and refused to another while it lives', async () => {
    const empty = await read(ana);
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({
      exists: false,
      revision: 0,
      data: null,
      updatedAt: null,
      checkedRevision: 0,
      heroes: [],
    });

    const before = Date.now();
    const first = await lease(ana, 'phone');
    expect(first.status).toBe(200);
    expect(first.body.revision).toBe(0);
    const until = Date.parse(first.body.leaseUntil);
    expect(until).toBeGreaterThanOrEqual(before + 299_000);
    expect(until).toBeLessThanOrEqual(Date.now() + 301_000);
    expect((await lease(ana, 'phone')).status).toBe(200);

    const other = await lease(ana, 'tablet');
    expect(other.status).toBe(409);
    expect(other.body.error).toBe('REALM_LEASED');
    expect(Date.parse(other.body.leaseUntil)).toBeGreaterThan(Date.now());
  });

  it('is never a guest’s', async () => {
    const visitor = await guest(base);
    for (const reply of [
      await lease(visitor, 'phone'),
      await read(visitor),
      await put(visitor, {
        deviceId: 'phone',
        baseRevision: 0,
        data: realmOf(),
        reason: 'create',
      }),
      await call<{ error: string }>(base, 'POST', '/api/realm/release', {
        token: visitor.token,
        body: { deviceId: 'phone' },
      }),
    ])
      expect([reply.status, reply.body.error]).toEqual([403, 'GUEST_ACCOUNT']);
    expect(
      (await call(base, 'GET', '/api/realm')).status,
      'without a session',
    ).toBe(401);
  });
});

describe('an upload', () => {
  it('needs the lease, builds on the current revision, and lands its checks on the heroes, builds and boards', async () => {
    const data = realmOf(
      heroOf(1, 'Ashgrove', 58, {
        records: [record('pit_floor', 70, 1), record('chart_tier', 9, 1)],
      }),
      heroOf(2, 'Wren', 44),
    );
    const stranger = await put(ana, {
      deviceId: 'tablet',
      baseRevision: 0,
      data,
      reason: 'create',
    });
    expect([stranger.status, stranger.body.error]).toEqual([409, 'LEASE_LOST']);

    const created = await upload(ana, 'phone', 0, data, { reason: 'create' });
    expect(created.status).toBe(200);
    expect(created.body.revision).toBe(1);

    const realm = await read(ana);
    expect(realm.body).toMatchObject({
      exists: true,
      revision: 1,
      checkedRevision: 1,
      data,
    });
    expect(
      realm.body.heroes.map((h) => [h.characterId, h.name, h.level, h.flagged]),
    ).toEqual([
      [1, 'Ashgrove', 58, false],
      [2, 'Wren', 44, false],
    ]);
    const [stored] =
      await sql`SELECT size, sha256 = encode(sha256(data), 'hex') AS same FROM realms WHERE user_id = ${ana.id}`;
    expect(stored.size).toBe(Buffer.from(data, 'base64').length);
    expect(stored.same).toBe(true);

    const pit = await board('pit_floor');
    expect(pit.map((row) => [row.hero.name, row.score, row.verdict])).toEqual([
      ['Ashgrove', 70, 'verified'],
    ]);
    expect(pit[0]?.build).toMatchObject({
      revision: 0,
      level: 58,
      gameVersion: '0.13.1',
      dps: 1_234,
    });
    const card = await call<{ card: CardPage[] }>(
      base,
      'GET',
      `/api/builds/${pit[0]?.build.id}`,
    );
    expect(card.body.card[0]?.title).toBe('Build');

    const page = await call<PlayerPage>(base, 'GET', `/api/players/${ana.id}`);
    expect(
      page.body.heroes.map((h) => [
        h.hero.name,
        h.hero.online,
        h.build?.level,
        h.records,
      ]),
    ).toEqual([
      [
        'Ashgrove',
        true,
        58,
        [
          { board: 'pit_floor', score: 70, rank: 1 },
          { board: 'chart_tier', score: 9, rank: 1 },
        ],
      ],
      ['Wren', true, 44, []],
    ]);
  });

  it('is refused at any revision but the current one, which it answers', async () => {
    const stale = await put(ana, {
      deviceId: 'phone',
      baseRevision: 0,
      data: realmOf(heroOf(1, 'Ashgrove', 58)),
      reason: 'checkpoint',
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      error: 'REVISION_MISMATCH',
      revision: 1,
    });
  });

  it('makes a new build only when the snapshot changed, and keeps a better record only', async () => {
    const asked = snapshotsAsked;
    const same = await upload(
      ana,
      'phone',
      1,
      realmOf(
        heroOf(1, 'Ashgrove', 58, { records: [record('pit_floor', 70, 1)] }),
        heroOf(2, 'Wren', 44),
      ),
      { reason: 'interval' },
    );
    expect(same.body.revision).toBe(2);
    expect(snapshotsAsked).toBe(asked + 2);
    const [builds] = await sql`SELECT count(*)::int AS n FROM hero_builds`;
    expect(builds.n).toBe(2);

    await upload(
      ana,
      'phone',
      2,
      realmOf(
        heroOf(1, 'Ashgrove', 59, { records: [record('pit_floor', 75, 1)] }),
        heroOf(2, 'Wren', 44),
      ),
    );
    const pit = await board('pit_floor');
    expect(
      pit.map((row) => [row.hero.name, row.score, row.build.level]),
    ).toEqual([['Ashgrove', 75, 59]]);
    expect(pit[0]?.build.revision).toBe(1);
  });

  it('flags an implausible hero (kept, off the boards), and skips records the checker does not trust', async () => {
    await upload(
      ana,
      'phone',
      3,
      realmOf(
        heroOf(1, 'Ashgrove', 59, {
          records: [
            record('pit_floor', 75, 1),
            record('map_s16', 400_000, 1, { witness: 'invalid' }),
            record('marks', 90, 1, { plausible: false }),
            record('trial_v', 500_000, 1, { ranked: false }),
          ],
        }),
        heroOf(2, 'Wren', 44, {
          plausible: false,
          reasons: [
            'the chart_tier record (Tier 16) is more than the hero has done',
          ],
          records: [record('chart_tier', 16, 2)],
        }),
      ),
    );
    const realm = await read(ana);
    expect(realm.body.heroes.find((h) => h.name === 'Wren')?.flagged).toBe(
      true,
    );
    const [note] =
      await sql`SELECT flag_note FROM heroes WHERE name = 'Wren' AND user_id = ${ana.id}`;
    expect(note.flag_note).toContain('Tier 16');
    expect((await board('chart_tier')).map((row) => row.hero.name)).toEqual([
      'Ashgrove',
    ]);
    expect(await board('map_s16')).toEqual([]);
    expect(await board('marks')).toEqual([]);
  });

  it('retires a hero that left the realm, its records kept', async () => {
    await upload(ana, 'phone', 4, realmOf(heroOf(2, 'Wren', 44)));
    const realm = await read(ana);
    expect(realm.body.heroes.map((h) => h.name)).toEqual(['Wren']);
    const page = await call<PlayerPage>(base, 'GET', `/api/players/${ana.id}`);
    expect(page.body.heroes.map((h) => h.hero.name)).toEqual(['Wren']);
    expect((await board('pit_floor')).map((row) => row.hero.name)).toEqual([
      'Ashgrove',
    ]);
    // Back in the realm, the same hero (its id) is back, not a new one.
    await upload(
      ana,
      'phone',
      5,
      realmOf(heroOf(1, 'Ashgrove', 59), heroOf(2, 'Wren', 44)),
    );
    const [count] =
      await sql`SELECT count(*)::int AS n FROM heroes WHERE user_id = ${ana.id} AND name = 'Ashgrove'`;
    expect(count.n).toBe(1);
  });

  it('flags every online hero of a realm that does not read', async () => {
    const garbage = Buffer.from('garbage').toString('base64');
    await upload(ana, 'phone', 6, garbage);
    expect((await read(ana)).body.heroes.every((h) => h.flagged)).toBe(true);
    expect(await board('pit_floor')).toEqual([]);
    await upload(
      ana,
      'phone',
      7,
      realmOf(heroOf(1, 'Ashgrove', 59), heroOf(2, 'Wren', 44)),
    );
    expect((await read(ana)).body.heroes.some((h) => h.flagged)).toBe(false);
    expect((await board('pit_floor')).map((row) => row.hero.name)).toEqual([
      'Ashgrove',
    ]);
  });

  it('is refused over 3 MB, and when its data is not base64', async () => {
    const big = Buffer.alloc(3_000_001, 65).toString('base64');
    const tooLarge = await put(ana, {
      deviceId: 'phone',
      baseRevision: 8,
      data: big,
      reason: 'checkpoint',
    });
    expect([tooLarge.status, tooLarge.body.error]).toEqual([
      413,
      'SAVE_TOO_LARGE',
    ]);
    const notBase64 = await put(ana, {
      deviceId: 'phone',
      baseRevision: 8,
      data: 'AAAAA===',
      reason: 'checkpoint',
    });
    expect(notBase64.status).toBe(400);
    expect(
      (
        await put(ana, {
          deviceId: 'phone',
          baseRevision: 8,
          data: realmOf(),
          reason: 'teleport',
        })
      ).status,
    ).toBe(400);
  });
});

describe('another device', () => {
  it('takes the lease by force, and the first device then loses it', async () => {
    const taken = await lease(ana, 'tablet', true);
    expect(taken.status).toBe(200);
    expect(taken.body.revision).toBe(8);
    const lost = await put(ana, {
      deviceId: 'phone',
      baseRevision: 8,
      data: realmOf(heroOf(1, 'Ashgrove', 59)),
      reason: 'checkpoint',
    });
    expect([lost.status, lost.body.error]).toEqual([409, 'LEASE_LOST']);
    expect((await lease(ana, 'phone')).status).toBe(409);
    const tablet = await upload(
      ana,
      'tablet',
      8,
      realmOf(heroOf(1, 'Ashgrove', 59), heroOf(2, 'Wren', 44)),
    );
    expect(tablet.body.revision).toBe(9);
  });

  it('keeps a lease that ran out until another device takes it (the grace), and gives it back at quit', async () => {
    await sql`UPDATE realms SET lease_until = now() - interval '20 minutes' WHERE user_id = ${ana.id}`;
    const late = await upload(
      ana,
      'tablet',
      9,
      realmOf(heroOf(1, 'Ashgrove', 59), heroOf(2, 'Wren', 44)),
      { reason: 'pause' },
    );
    expect(late.status).toBe(200);
    const [row] =
      await sql`SELECT lease_until > now() + interval '4 minutes' AS renewed FROM realms WHERE user_id = ${ana.id}`;
    expect(row.renewed).toBe(true);

    const release = (deviceId: string) =>
      call<{ released: boolean }>(base, 'POST', '/api/realm/release', {
        token: ana.token,
        body: { deviceId },
      });
    expect((await release('phone')).body.released).toBe(false);
    expect((await release('tablet')).body.released).toBe(true);
    expect((await release('tablet')).body.released).toBe(false);
    expect((await lease(ana, 'phone')).status).toBe(200);
  });
});

describe('moving offline heroes online', () => {
  const vey = heroOf(3, 'Vey', 30, { fingerprint: 'f'.repeat(64) });

  it('keeps each moved hero, and refuses the same hero a second time, to any account', async () => {
    const moved = await upload(
      ana,
      'phone',
      10,
      realmOf(heroOf(1, 'Ashgrove', 59), heroOf(2, 'Wren', 44), vey),
      { reason: 'transfer', transferred: [3] },
    );
    expect(moved.status).toBe(200);
    expect(moved.body.revision).toBe(11);
    const [kept] =
      await sql`SELECT user_id, character_id FROM realm_transfers WHERE fingerprint = ${'f'.repeat(64)}`;
    expect([kept.user_id, kept.character_id]).toEqual([ana.id, 3]);

    const again = await put(ana, {
      deviceId: 'phone',
      baseRevision: 11,
      data: realmOf(heroOf(1, 'Ashgrove', 59), vey, { ...vey, characterId: 4 }),
      reason: 'transfer',
      transferred: [4],
    });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({
      error: 'ALREADY_TRANSFERRED',
      characterIds: [4],
    });
    expect((await read(ana)).body.revision).toBe(11);

    await lease(bo, 'bo-phone');
    const elsewhere = await put(bo, {
      deviceId: 'bo-phone',
      baseRevision: 0,
      data: realmOf({ ...vey, characterId: 1 }),
      reason: 'transfer',
      transferred: [1],
    });
    expect(elsewhere.body).toMatchObject({
      error: 'ALREADY_TRANSFERRED',
      characterIds: [1],
    });
  });

  it('refuses a hero the realm does not hold, and waits when the checker cannot read it', async () => {
    const missing = await put(bo, {
      deviceId: 'bo-phone',
      baseRevision: 0,
      data: realmOf(heroOf(1, 'Mott', 20)),
      reason: 'transfer',
      transferred: [7],
    });
    expect(missing.status).toBe(400);
    checkerDown = true;
    const down = await put(bo, {
      deviceId: 'bo-phone',
      baseRevision: 0,
      data: realmOf(heroOf(1, 'Mott', 20)),
      reason: 'transfer',
      transferred: [1],
    });
    checkerDown = false;
    expect([down.status, down.body.error]).toEqual([
      503,
      'CHECKER_UNAVAILABLE',
    ]);
    expect((await read(bo)).body.revision).toBe(0);
  });

  it('leaves a realm unchecked while the checker is down, and checks it at the next upload', async () => {
    checkerDown = true;
    const first = await upload(
      bo,
      'bo-phone',
      0,
      realmOf(heroOf(1, 'Mott', 20)),
    );
    checkerDown = false;
    expect(first.status).toBe(200);
    expect((await read(bo)).body).toMatchObject({
      revision: 1,
      checkedRevision: 0,
      heroes: [],
    });
    await upload(bo, 'bo-phone', 1, realmOf(heroOf(1, 'Mott', 21)));
    expect((await read(bo)).body).toMatchObject({
      revision: 2,
      checkedRevision: 2,
      heroes: [{ name: 'Mott', level: 21 }],
    });
  });
});

describe('the boards, online only', () => {
  it("keep an offline hero's score off every board, answering it as v0.13.0 expects", async () => {
    const offline = await call<{ hero: { id: string } }>(
      base,
      'POST',
      '/api/heroes',
      { token: bo.token, body: { name: 'Offline', class: 'barbarian' } },
    );
    const scored = await call<SubmitResult>(
      base,
      'POST',
      '/api/leaderboards/pit_floor/scores',
      {
        token: bo.token,
        body: {
          heroId: offline.body.hero.id,
          score: 900,
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
    expect(scored.body).toMatchObject({
      result: 'new',
      entry: { score: 900, verdict: 'pending', rank: null },
      check: { verdict: 'pending' },
    });
    expect((await board('pit_floor')).map((row) => row.hero.name)).toEqual([
      'Ashgrove',
    ]);
    const around = await call<{ entry: unknown }>(
      base,
      'GET',
      '/api/leaderboards/pit_floor/me',
      { token: bo.token },
    );
    expect(around.body.entry).toBeNull();
  });

  it("refuse an online hero's score and build: its realm is its only source", async () => {
    const [mott] =
      await sql`SELECT id FROM heroes WHERE user_id = ${bo.id} AND name = 'Mott'`;
    const scored = await call<{ error: string }>(
      base,
      'POST',
      '/api/leaderboards/pit_floor/scores',
      {
        token: bo.token,
        body: {
          heroId: mott.id,
          score: 1,
          build: {
            revision: 9,
            gameVersion: '0.13.0',
            level: 21,
            skills: [],
            gear: [],
            talents: {},
            summary: { dps: 1, clearDps: 1, ehp: 1, life: 1 },
          },
        },
      },
    );
    expect([scored.status, scored.body.error]).toEqual([409, 'HERO_ONLINE']);
    const built = await call<{ error: string }>(
      base,
      'POST',
      `/api/heroes/${mott.id}/builds`,
      {
        token: bo.token,
        body: {
          build: {
            revision: 9,
            gameVersion: '0.13.0',
            level: 21,
            skills: [],
            gear: [],
            talents: {},
            summary: { dps: 1, clearDps: 1, ehp: 1, life: 1 },
          },
        },
      },
    );
    expect([built.status, built.body.error]).toEqual([409, 'HERO_ONLINE']);
    // An offline hero may share an online one's name: registering finds the offline one only.
    const named = await call<{ hero: { id: string; online: boolean } }>(
      base,
      'POST',
      '/api/heroes',
      { token: bo.token, body: { name: 'Mott', class: 'barbarian' } },
    );
    expect(named.status).toBe(200);
    expect(named.body.hero.id).not.toBe(mott.id);
    expect(named.body.hero.online).toBe(false);
  });
});

describe('deleting the account', () => {
  it('takes the realm and its transfers along', async () => {
    expect(
      (
        await call(base, 'POST', '/api/account/delete', {
          token: ana.token,
          body: { password: 'a long enough password' },
        })
      ).status,
    ).toBe(200);
    const [left] =
      await sql`SELECT (SELECT count(*)::int FROM realms WHERE user_id = ${ana.id}) AS realms, (SELECT count(*)::int FROM realm_transfers WHERE user_id = ${ana.id}) AS transfers`;
    expect([left.realms, left.transfers]).toEqual([0, 0]);
    expect(await board('pit_floor')).toEqual([]);
  });
});
