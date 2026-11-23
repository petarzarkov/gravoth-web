import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { provide } from '@dunx/core';
import type {
  BuildSnapshot,
  HeroBuildPosted,
  PlayerPage,
  SubmitResult,
} from '@gravoth/contracts';
import { eq } from 'drizzle-orm';
import { AppConfigService } from './config.js';
import { Db } from './database/db.js';
import { hero } from './database/schema.js';
import {
  ValidatorClient,
  type CardPage,
  type SaveReport,
} from './gravoth/validator.client.js';
import { startTestApp, type TestApp } from './testing/app.js';
import { call, guest, signUp, type Player } from './testing/http.js';

/**
 * Decision 226 over HTTP: every hero's build (`POST /api/heroes/:id/builds`, the card from the save sent or the
 * account's cloud save), the offline heroes still on the phone (`POST /api/heroes/active`), and the player page
 * (`GET /api/players/:userId`): all of a player's heroes with their newest builds and records, public unless the
 * profile is hidden, then for friends and the player only.
 *
 * The rules checker is a stand-in: its card names the save it read and the hero, so a test can tell which save it was.
 */
const cardsRead: { save: string; heroId: number }[] = [];
class StandInValidator extends ValidatorClient {
  override async up(): Promise<boolean> {
    return true;
  }
  override async check(save: string): Promise<SaveReport> {
    return JSON.parse(save) as SaveReport;
  }
  override async card(save: string, heroId: number): Promise<CardPage[]> {
    cardsRead.push({ save, heroId });
    return [
      {
        title: 'Build',
        sections: [
          { title: 'Read', rows: [{ label: 'hero', value: String(heroId) }] },
        ],
      },
    ];
  }
}

const buildAt = (
  revision: number,
  level: number,
  dps = 1_000,
): BuildSnapshot => ({
  revision,
  gameVersion: '0.13.1',
  level,
  ascendancy: null,
  skills: [{ id: 'cleave', level: 10, slot: 0, supports: [] }],
  gear: [],
  talents: {},
  atlas: {},
  auras: [],
  extras: { border: 'pit_30' },
  summary: { dps, clearDps: dps / 2, ehp: 9_000, life: 2_000, energyShield: 0 },
});

/** A save the stand-in reads for a verified score: this one hero, at this level. */
const saveOf = (id: number, name: string, level: number): string =>
  JSON.stringify({
    ok: true,
    needsNewerBuild: false,
    needs: 0,
    warnings: [],
    heroes: [
      {
        id,
        name,
        class: 'Barbarian',
        level,
        dps: 1,
        clearDps: 1,
        ehp: 1,
        life: 1,
        charts: 0,
        highestChartTier: 16,
      },
    ],
  } satisfies SaveReport);

let started: TestApp;
let base = '';
let db: Db;
let ana: Player;
let bo: Player;
let cy: Player;
const ids: Record<string, string> = {};

const post = <T>(path: string, who: Player | undefined, body: unknown) =>
  call<T>(base, 'POST', path, { token: who?.token, body });
const get = <T>(path: string, who?: Player) =>
  call<T>(base, 'GET', path, { token: who?.token });
const register = async (who: Player, name: string, hardcore = false) => {
  const reply = await post<{ hero: { id: string } }>('/api/heroes', who, {
    name,
    class: 'barbarian',
    hardcore,
  });
  expect(reply.status).toBe(200);
  ids[name] = reply.body.hero.id;
  return reply.body.hero.id;
};
const postBuild = (who: Player, name: string, body: unknown) =>
  post<HeroBuildPosted & { error?: string }>(
    `/api/heroes/${ids[name]}/builds`,
    who,
    body,
  );
const pageOf = (who: Player | undefined, userId: string) =>
  get<PlayerPage & { error?: string }>(`/api/players/${userId}`, who);

/** A hero's records show on the boards (and so on its page) once it is online (decision 227): its realm, stood in for. */
const online = async (...names: string[]) => {
  for (const name of names)
    await db
      .update(hero)
      .set({ online: true })
      .where(eq(hero.id, ids[name] ?? ''));
};

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
  db = started.app.get(Db);
  ana = await signUp(base, 'Ana', 'ana@players.test');
  bo = await signUp(base, 'Bodhi', 'bo@players.test');
  cy = await signUp(base, 'Cyra', 'cy@players.test');
  const asked = await post<{ request: { id: string } }>(
    '/api/friends/requests',
    ana,
    { displayName: 'Bodhi' },
  );
  await post(`/api/friends/requests/${asked.body.request.id}/accept`, bo, {});
  for (const name of ['Kriso', 'Lyra', 'Ash']) await register(ana, name);
  await register(ana, 'Vey', true);
});

afterAll(async () => {
  await started.close();
});

describe("a hero's build", () => {
  it('is stored once, and answered as it is while it does not change', async () => {
    const first = await postBuild(ana, 'Kriso', { build: buildAt(0, 40) });
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(true);
    expect(first.body.build).toMatchObject({
      heroId: ids['Kriso'],
      revision: 0,
      level: 40,
      extras: { border: 'pit_30' },
    });

    const same = await postBuild(ana, 'Kriso', { build: buildAt(0, 40) });
    expect(same.body).toMatchObject({
      created: false,
      build: { id: first.body.build.id },
    });
    const next = await postBuild(ana, 'Kriso', { build: buildAt(1, 41) });
    expect(next.body.created).toBe(true);
    expect(next.body.build.revision).toBe(1);
    const taken = await postBuild(ana, 'Kriso', { build: buildAt(1, 42) });
    expect([taken.status, taken.body.error]).toEqual([
      409,
      'BUILD_REVISION_TAKEN',
    ]);
  });

  it("carries the checker's card from the save sent, else from the cloud save, and none without a hero id", async () => {
    cardsRead.length = 0;
    const sent = await postBuild(ana, 'Lyra', {
      build: buildAt(0, 30),
      save: 'the save sent',
      saveHeroId: 2,
    });
    expect(sent.status).toBe(200);
    expect(cardsRead).toEqual([{ save: 'the save sent', heroId: 2 }]);
    const card = await get<{ card: CardPage[] | null }>(
      `/api/builds/${sent.body.build.id}`,
    );
    expect(card.body.card?.[0]?.title).toBe('Build');

    const block = 'GRAVOTH-SAVE 1 t 00000000 the cloud copy';
    const stored = await call(base, 'PUT', '/api/saves/me', {
      token: ana.token,
      body: { data: Buffer.from(block).toString('base64') },
    });
    expect(stored.status).toBe(200);
    cardsRead.length = 0;
    await postBuild(ana, 'Lyra', { build: buildAt(1, 31), saveHeroId: 3 });
    expect(cardsRead).toEqual([{ save: block, heroId: 3 }]);

    cardsRead.length = 0;
    const plain = await postBuild(ana, 'Lyra', { build: buildAt(2, 32) });
    expect(plain.status).toBe(200);
    expect(cardsRead).toEqual([]);
    expect(
      (await get<{ card: unknown }>(`/api/builds/${plain.body.build.id}`)).body
        .card,
    ).toBeNull();
  });

  it("is refused for another account's hero, a stranger, and a build that is not one", async () => {
    expect(
      (await postBuild(bo, 'Kriso', { build: buildAt(5, 40) })).status,
    ).toBe(404);
    expect(
      (await postBuild(ana, 'Kriso', { build: { level: 40 } })).status,
    ).toBe(400);
    expect(
      (
        await post(`/api/heroes/${ids['Kriso']}/builds`, undefined, {
          build: buildAt(5, 40),
        })
      ).status,
    ).toBe(401);
  });
});

describe('hero names (decision 229, the bad-words list)', () => {
  it('are checked for the game without a session, whole words and the parts of a name', async () => {
    const check = async (name: string) =>
      (
        await get<{ allowed: boolean }>(
          `/api/heroes/name-check?name=${encodeURIComponent(name)}`,
        )
      ).body.allowed;
    expect(await check('Ember')).toBe(true);
    expect(await check('Scunthorpe')).toBe(true);
    expect(await check('Fuck_face')).toBe(false);
    expect(await check('shit2')).toBe(false);
    expect((await get('/api/heroes/name-check?name=')).status).toBe(400);
  });

  it('are kept with their profane words masked when a phone registers one', async () => {
    const eira = await signUp(base, 'Eira', 'eira@players.test');
    const reply = await post<{ hero: { name: string } }>('/api/heroes', eira, {
      name: 'Shit_Slayer',
      class: 'barbarian',
    });
    expect([reply.status, reply.body.hero.name]).toEqual([200, '****_Slayer']);
    const again = await post<{ hero: { name: string }; created: boolean }>(
      '/api/heroes',
      eira,
      {
        name: 'Shit_Slayer',
        class: 'barbarian',
      },
    );
    expect([again.body.hero.name, again.body.created]).toEqual([
      '****_Slayer',
      false,
    ]);
  });
});

describe('the offline heroes still on the phone', () => {
  it('retire the others, and bring a listed one back', async () => {
    const reply = await post<{ retired: number }>('/api/heroes/active', ana, {
      heroIds: [ids['Kriso'], ids['Lyra'], ids['Vey']],
    });
    expect(reply.status).toBe(200);
    expect(reply.body.retired).toBe(1);
    const page = await pageOf(undefined, ana.id);
    expect(page.body.heroes.map((h) => h.hero.name)).not.toContain('Ash');

    const again = await post<{ retired: number }>('/api/heroes/active', ana, {
      heroIds: [ids['Kriso'], ids['Lyra'], ids['Vey'], ids['Ash']],
    });
    expect(again.body.retired).toBe(0);
    expect(
      (await pageOf(undefined, ana.id)).body.heroes.map((h) => h.hero.name),
    ).toContain('Ash');
  });

  it('take only uuids, at most 64, and never another account', async () => {
    expect(
      (await post('/api/heroes/active', ana, { heroIds: ['nope'] })).status,
    ).toBe(400);
    expect(
      (
        await post('/api/heroes/active', ana, {
          heroIds: Array.from({ length: 65 }, () => crypto.randomUUID()),
        })
      ).status,
    ).toBe(400);
    const boHero = await register(bo, 'Mott');
    expect(
      (
        await post<{ retired: number }>('/api/heroes/active', ana, {
          heroIds: [ids['Kriso'], ids['Lyra'], ids['Vey'], ids['Ash'], boHero],
        })
      ).body.retired,
    ).toBe(0);
    expect(
      (await pageOf(undefined, bo.id)).body.heroes.map((h) => h.hero.name),
    ).toEqual(['Mott']);
  });

  it("let two phones with different saves keep each other's heroes (decision 229)", async () => {
    const dara = await signUp(base, 'Dara', 'dara@players.test');
    const reg = async (name: string, deviceId?: string) =>
      (
        await post<{ hero: { id: string } }>('/api/heroes', dara, {
          name,
          class: 'barbarian',
          ...(deviceId === undefined ? {} : { deviceId }),
        })
      ).body.hero.id;
    const a1 = await reg('PhoneA_one', 'phone-a');
    const b1 = await reg('PhoneB_one', 'phone-b');
    await reg('Unclaimed');
    const names = async () =>
      (await pageOf(undefined, dara.id)).body.heroes
        .map((h) => h.hero.name)
        .sort();
    const active = async (heroIds: string[], deviceId?: string) =>
      (
        await post<{ retired: number }>('/api/heroes/active', dara, {
          heroIds,
          ...(deviceId === undefined ? {} : { deviceId }),
        })
      ).body.retired;

    // Phone A lists its own: phone B's hero stays, the hero no phone claimed goes.
    expect(await active([a1], 'phone-a')).toBe(1);
    expect(await names()).toEqual(['PhoneA_one', 'PhoneB_one']);
    // Phone B lists its own: phone A's stays.
    expect(await active([b1], 'phone-b')).toBe(0);
    expect(await names()).toEqual(['PhoneA_one', 'PhoneB_one']);
    // An older game sends no device: it retires only unclaimed heroes, never a phone's.
    expect(await active([])).toBe(0);
    expect(await names()).toEqual(['PhoneA_one', 'PhoneB_one']);
    // A hero gone from phone A goes; a hero listed by phone A (moved there) becomes phone A's.
    expect(await active([b1], 'phone-a')).toBe(1);
    expect(await names()).toEqual(['PhoneB_one']);
    expect(await active([], 'phone-b')).toBe(0);
    expect(await names()).toEqual(['PhoneB_one']);
    // Registering again from another phone claims it there.
    await reg('PhoneB_one', 'phone-c');
    expect(await active([], 'phone-a')).toBe(0);
    expect(await names()).toEqual(['PhoneB_one']);
    expect(await active([], 'phone-c')).toBe(1);
    expect(await names()).toEqual([]);
  });

  it("are held by the phone that last posted a hero's build (decision 229)", async () => {
    const wyn = await signUp(base, 'Wynne', 'wynne@players.test');
    const reg = async (name: string) =>
      (
        await post<{ hero: { id: string } }>('/api/heroes', wyn, {
          name,
          class: 'barbarian',
        })
      ).body.hero.id;
    const build = (heroId: string, deviceId?: string) =>
      post<HeroBuildPosted & { error?: string }>(
        `/api/heroes/${heroId}/builds`,
        wyn,
        {
          build: buildAt(0, 10),
          ...(deviceId === undefined ? {} : { deviceId }),
        },
      );
    const active = async (heroIds: string[], deviceId?: string) =>
      (
        await post<{ retired: number }>('/api/heroes/active', wyn, {
          heroIds,
          ...(deviceId === undefined ? {} : { deviceId }),
        })
      ).body.retired;
    const names = async () =>
      (await pageOf(undefined, wyn.id)).body.heroes
        .map((h) => h.hero.name)
        .sort();
    const a = await reg('OnPhoneA');
    const b = await reg('OnPhoneB');
    expect((await build(a, 'phone-a')).status).toBe(200);
    expect((await build(b, 'phone-b')).status).toBe(200);
    expect(
      (
        await post(`/api/heroes/${a}/builds`, wyn, {
          build: buildAt(1, 11),
          deviceId: ' ',
        })
      ).status,
    ).toBe(400);

    // Each phone lists only its own heroes; neither retires the other's.
    expect(await active([a], 'phone-a')).toBe(0);
    expect(await active([b], 'phone-b')).toBe(0);
    expect(await active([], 'phone-a')).toBe(1);
    expect(await names()).toEqual(['OnPhoneB']);
    // Phone A posts B's build (the save moved there): A holds it now, and B's list no longer reaches it.
    expect((await build(b, 'phone-a')).body.created).toBe(false);
    expect(await active([], 'phone-b')).toBe(0);
    expect(await names()).toEqual(['OnPhoneB']);
    // A build posted without a device (an older game) brings a hero back and leaves its phone as it was.
    expect((await build(a)).status).toBe(200);
    expect(await names()).toEqual(['OnPhoneA', 'OnPhoneB']);
    expect(await active([], 'phone-b')).toBe(0);
    expect(await active([b], 'phone-a')).toBe(1);
    expect(await names()).toEqual(['OnPhoneB']);
  });

  it('bring a retired hero back when its build is posted', async () => {
    await post('/api/heroes/active', ana, {
      heroIds: [ids['Kriso'], ids['Lyra'], ids['Vey']],
    });
    expect(
      (await pageOf(undefined, ana.id)).body.heroes.map((h) => h.hero.name),
    ).not.toContain('Ash');
    await postBuild(ana, 'Ash', { build: buildAt(0, 12) });
    expect(
      (await pageOf(undefined, ana.id)).body.heroes.map((h) => h.hero.name),
    ).toContain('Ash');
  });
});

describe('a player page', () => {
  it('shows every hero with its newest build and its records, highest level first', async () => {
    const scored = await post<SubmitResult>(
      '/api/leaderboards/pit_floor/scores',
      ana,
      {
        heroId: ids['Kriso'],
        score: 44,
        build: buildAt(1, 41),
        save: saveOf(1, 'Kriso', 41),
        saveHeroId: 1,
      },
    );
    expect(scored.status).toBe(200);
    await post('/api/leaderboards/chart_tier/scores', ana, {
      heroId: ids['Kriso'],
      score: 6,
      build: buildAt(1, 41),
      save: saveOf(1, 'Kriso', 41),
      saveHeroId: 1,
    });
    await online('Kriso');

    const page = await pageOf(undefined, ana.id);
    expect(page.status).toBe(200);
    expect(page.body.player).toMatchObject({
      userId: ana.id,
      displayName: 'Ana',
      hidden: false,
      avatar: { kind: 'portrait' },
    });
    expect(
      page.body.heroes.map((h) => [h.hero.name, h.build?.level ?? null]),
    ).toEqual([
      ['Kriso', 41],
      ['Lyra', 32],
      ['Ash', 12],
      ['Vey', null],
    ]);
    const kriso = page.body.heroes[0];
    expect(kriso?.hero).toMatchObject({ class: 'barbarian', online: true });
    expect(kriso?.build).toMatchObject({
      revision: 1,
      extras: { border: 'pit_30' },
    });
    expect(kriso?.records).toEqual([
      { board: 'pit_floor', score: 44, rank: 1 },
      { board: 'chart_tier', score: 6, rank: 1 },
    ]);
    expect(page.body.heroes[3]?.hero.hardcore).toBe(true);
  });

  it("ranks a hero's record as its board does", async () => {
    const mott = ids['Mott'] ?? '';
    await post('/api/leaderboards/pit_floor/scores', bo, {
      heroId: mott,
      score: 60,
      build: buildAt(1, 50),
      save: saveOf(1, 'Mott', 50),
      saveHeroId: 1,
    });
    await online('Mott');
    const page = await pageOf(undefined, ana.id);
    expect(page.body.heroes[0]?.records[0]).toEqual({
      board: 'pit_floor',
      score: 44,
      rank: 2,
    });
    const board = await get<{
      entries: { data: { hero: { name: string }; rank: number }[] };
    }>('/api/leaderboards/pit_floor');
    expect(
      board.body.entries.data.find((row) => row.hero.name === 'Kriso')?.rank,
    ).toBe(2);
  });

  it("shows a hidden player's page to friends and the player only", async () => {
    await call(base, 'PATCH', '/api/profile', {
      token: ana.token,
      body: { publicProfile: false },
    });
    const stranger = await pageOf(cy, ana.id);
    expect([stranger.status, stranger.body.error]).toEqual([
      404,
      'PLAYER_NOT_FOUND',
    ]);
    expect((await pageOf(undefined, ana.id)).status).toBe(404);
    const friend = await pageOf(bo, ana.id);
    expect(friend.status).toBe(200);
    expect(friend.body.player.hidden).toBe(true);
    expect(friend.body.heroes).toHaveLength(4);
    expect((await pageOf(ana, ana.id)).status).toBe(200);
    await call(base, 'PATCH', '/api/profile', {
      token: ana.token,
      body: { publicProfile: true },
    });
  });

  it("is no player at all for an unknown id, and a guest's heroes show", async () => {
    const unknown = await pageOf(undefined, crypto.randomUUID());
    expect([unknown.status, unknown.body.error]).toEqual([
      404,
      'PLAYER_NOT_FOUND',
    ]);
    expect((await get('/api/players/not-a-uuid')).status).toBe(400);
    const visitor = await guest(base);
    const reply = await post<{ hero: { id: string } }>('/api/heroes', visitor, {
      name: 'Wanderer',
      class: 'barbarian',
    });
    await post(`/api/heroes/${reply.body.hero.id}/builds`, visitor, {
      build: buildAt(0, 3),
    });
    const page = await pageOf(undefined, visitor.id);
    expect(page.status).toBe(200);
    expect(page.body.heroes.map((h) => [h.hero.name, h.build?.level])).toEqual([
      ['Wanderer', 3],
    ]);
  });
});
