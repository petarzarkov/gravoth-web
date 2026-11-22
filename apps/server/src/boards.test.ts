import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { provide } from '@dunx/core';
import { EmailTransport, MemoryTransport } from '@dunx/infra/email';
import { AppConfigService } from './config.js';
import { ValidatorClient, type CardPage, type SaveReport } from './gravoth/validator.client.js';
import type { BuildSnapshot } from './heroes/build.schema.js';
import { startTestApp, type TestApp } from './testing/app.js';
import { call, guest, signUp, type Player } from './testing/http.js';

/**
 * Boards over HTTP: heroes registered, scores posted with their builds, the rules checker's verdicts, the top of a
 * board with every row's build, the caller's neighbourhood, the friends view, the hardcore twins, and the build card.
 *
 * The rules checker is a stand-in that reads a "save" written as JSON by the test (the real one reads the game's save
 * format with the game's own Core; its contract is `ValidatorClient`'s).
 */
class StandInValidator extends ValidatorClient {
  override async up(): Promise<boolean> {
    return true;
  }
  override async check(save: string): Promise<SaveReport> {
    if (save === 'unreachable') throw new Error('connection refused');
    if (save === 'garbage') return { ok: false, needsNewerBuild: false, needs: 0, warnings: ['unreadable'], heroes: [] };
    return JSON.parse(save) as SaveReport;
  }
  override async card(_save: string, heroId: number): Promise<CardPage[] | null> {
    return [{ title: 'Build', sections: [{ title: 'Hero', rows: [{ label: 'Save hero', value: String(heroId) }] }] }];
  }
}

const saveOf = (heroes: { id: number; name: string; class: string; level: number; highestChartTier?: number; dps?: number }[]): string =>
  JSON.stringify({
    ok: true,
    needsNewerBuild: false,
    needs: 0,
    warnings: [],
    heroes: heroes.map((h) => ({ clearDps: 900, ehp: 12_000, life: 3_100, charts: 4, highestChartTier: 1, dps: 1_500, ...h })),
  } satisfies SaveReport);

const buildAt = (revision: number, level = 60, dps = 1_234): BuildSnapshot => ({
  revision,
  gameVersion: '0.12.0',
  level,
  ascendancy: 'berserker',
  skills: [
    { id: 'cleave', level: 18, quality: 10, slot: 0, supports: [{ id: 'brutality', level: 15 }, { id: 'melee_splash', level: 12 }] },
    { id: 'war_cry', level: 10, supports: [] },
  ],
  gear: [
    {
      slot: 'MainHand',
      name: 'Grief Edge',
      base: 'Broad Axe',
      rarity: 'Rare',
      itemLevel: 68,
      lines: [
        { text: '+42% increased Physical Damage', kind: 'prefix', tier: 2, values: [42] },
        { text: 'Adds 12 to 24 Physical Damage', kind: 'prefix', tier: 3, values: [12, 24] },
        { text: '+18% to Fire Resistance', kind: 'suffix', tier: 5, values: [18] },
      ],
    },
    { slot: 'Chest', name: "Kriso's Vow", base: 'Plate Vest', rarity: 'Unique', itemLevel: 60, lines: [{ text: '+80 to maximum Life', kind: 'unique' }] },
  ],
  talents: { allocated: ['might_1', 'might_2', 'cleave_mastery'], ascendancy: ['berserker_rage'] },
  atlas: { highestTier: 12, nodes: ['quantity_1'] },
  auras: [{ id: 'fury', level: 8, reservedPercent: 25 }],
  extras: { rites: ['ashfall'], cosmetics: { frame: 'gold' } },
  summary: { dps, clearDps: 800, ehp: 9_000, life: 2_900, energyShield: 0, resistances: { fire: 75, cold: 60, lightning: 70, chaos: -20 } },
});

interface Entry {
  rank: number;
  id: string;
  score: number;
  verdict: string;
  player: { userId: string | null; displayName: string; hidden: boolean };
  hero: { id: string; name: string; class: string; hardcore: boolean };
  build: { id: string; revision: number; dps: number; skills: { id: string; supports: unknown[] }[]; gear: { lines: unknown[] }[]; talents: Record<string, unknown> };
}
interface BoardPage {
  board: { key: string; title: string; hardcore: boolean; sort: string };
  entries: { data: Entry[]; meta: { hasNextPage: boolean; hasPreviousPage: boolean; nextCursor: string | null; previousCursor: string | null } };
}
interface Submitted {
  result: 'new' | 'improved' | 'kept';
  entry: { id: string; score: number; buildId: string; verdict: string; verdictNote: string | null; rank: number | null };
}

const mail = new MemoryTransport();
let started: TestApp;
let base = '';
let ana: Player;
let bo: Player;
let cy: Player;
const heroIds: Record<string, string> = {};

const post = <T>(path: string, who: Player | undefined, body: unknown) => call<T>(base, 'POST', path, { token: who?.token, body });
const get = <T>(path: string, who?: Player) => call<T>(base, 'GET', path, { token: who?.token });
const register = async (who: Player, name: string, heroClass: string, hardcore = false) => {
  const reply = await post<{ hero: { id: string }; created: boolean }>('/api/heroes', who, { name, class: heroClass, hardcore });
  expect(reply.status).toBe(200);
  heroIds[name] = reply.body.hero.id;
  return reply;
};
const score = (who: Player, key: string, body: Record<string, unknown>) => post<Submitted>(`/api/leaderboards/${key}/scores`, who, body);

beforeAll(async () => {
  started = await startTestApp({
    overrides: [
      provide(EmailTransport, { useValue: mail }),
      provide(ValidatorClient, { useFactory: (config: AppConfigService) => new StandInValidator(config), inject: [AppConfigService] }),
    ],
  });
  base = started.base;
  ana = await signUp(base, 'Ana', 'ana@boards.test');
  bo = await signUp(base, 'Bodhi', 'bo@boards.test');
  cy = await signUp(base, 'Cyra', 'cy@boards.test');
  const asked = await post<{ request: { id: string } }>('/api/friends/requests', ana, { displayName: 'Bodhi' });
  await post(`/api/friends/requests/${asked.body.request.id}/accept`, bo, {});
});

afterAll(async () => {
  await started.close();
});

describe('the board catalog', () => {
  it('has the game boards, each with a hardcore twin', async () => {
    const all = await get<{ boards: { key: string; title: string; hardcore: boolean; sort: string; format: string }[] }>('/api/leaderboards');

    expect(all.status).toBe(200);
    expect(all.body.boards).toHaveLength(10);
    expect(all.body.boards.find((b) => b.key === 'map_s16' && !b.hardcore)).toMatchObject({ title: 'Fastest S16 map clear', sort: 'asc', format: 'time_ms' });
    const hardcore = await get<{ boards: { title: string; hardcore: boolean }[] }>('/api/leaderboards?hardcore=true');
    expect(hardcore.body.boards.map((b) => b.title)).toContain('Hardcore deepest Bone Pit floor');
    expect(hardcore.body.boards.every((b) => b.hardcore)).toBe(true);
    expect((await get('/api/leaderboards/no_such_board')).status).toBe(404);
  });
});

describe('heroes', () => {
  it('registers once by name, finding the same hero again in any case', async () => {
    const first = await register(ana, 'Kriso', 'Barbarian');
    expect(first.body.created).toBe(true);

    const again = await post<{ hero: { id: string }; created: boolean }>('/api/heroes', ana, { name: 'kriso', class: 'barbarian' });
    expect(again.body).toMatchObject({ created: false, hero: { id: first.body.hero.id } });
    expect((await post('/api/heroes', ana, { name: 'KRISO', class: 'ranger' })).status).toBe(409);

    await register(ana, 'Lyra', 'sorcerer', true);
    await register(bo, 'Mott', 'ranger');
    await register(cy, 'Vex', 'templar');
    expect((await get<{ heroes: { name: string }[] }>('/api/heroes', ana)).body.heroes.map((h) => h.name)).toEqual(['Kriso', 'Lyra']);
  });
});

describe('posting a score with its build', () => {
  it('is verified by the rules checker, which supplies the numbers and the card', async () => {
    const save = saveOf([{ id: 3, name: 'Kriso', class: 'Barbarian', level: 60, dps: 2_222 }]);
    const posted = await score(ana, 'pit_floor', { heroId: heroIds['Kriso'], score: 40, build: buildAt(1), save, saveHeroId: 3, achievedAt: '2026-11-20T10:00:00Z' });

    expect(posted.status).toBe(200);
    expect(posted.body).toMatchObject({ result: 'new', entry: { score: 40, verdict: 'verified', verdictNote: null, rank: 1 } });
    const card = await get<{ dps: number; card: { title: string }[]; hero: { name: string }; player: { displayName: string } }>(`/api/builds/${posted.body.entry.buildId}`);
    expect(card.status).toBe(200);
    expect(card.body).toMatchObject({ dps: 2_222, hero: { name: 'Kriso' }, player: { displayName: 'Ana' } });
    expect(card.body.card[0]?.title).toBe('Build');
  });

  it('is pending without a save or with the checker down, and ranks by score then by the earlier time', async () => {
    const mott = await score(bo, 'pit_floor', { heroId: heroIds['Mott'], score: 55, build: buildAt(1), achievedAt: '2026-11-20T11:00:00Z' });
    expect(mott.body.entry).toMatchObject({ verdict: 'pending', verdictNote: 'no save came with the score', rank: 1 });

    const vex = await score(cy, 'pit_floor', {
      heroId: heroIds['Vex'],
      score: 40,
      build: buildAt(1),
      save: 'unreachable',
      saveHeroId: 1,
      achievedAt: '2026-11-21T10:00:00Z',
    });
    expect(vex.body.entry).toMatchObject({ verdict: 'pending', verdictNote: 'the rules checker did not answer', rank: 3 });
  });

  it('replaces a hero best only with a better score, keeping the build that set it', async () => {
    const better = await score(ana, 'pit_floor', { heroId: heroIds['Kriso'], score: 60, build: buildAt(2, 62, 3_000), achievedAt: '2026-11-21T12:00:00Z' });
    expect(better.body).toMatchObject({ result: 'improved', entry: { score: 60, rank: 1 } });

    const worse = await score(ana, 'pit_floor', { heroId: heroIds['Kriso'], score: 30, build: buildAt(3), achievedAt: '2026-11-21T13:00:00Z' });
    expect(worse.body).toMatchObject({ result: 'kept', entry: { score: 60, buildId: better.body.entry.buildId } });
  });

  it('refuses a different build at a revision already stored, a score off the board, the wrong twin, and a stranger hero', async () => {
    expect((await score(ana, 'pit_floor', { heroId: heroIds['Kriso'], score: 61, build: buildAt(2, 62, 9_999) })).status).toBe(409);
    expect((await score(ana, 'chart_tier', { heroId: heroIds['Kriso'], score: 17, build: buildAt(4) })).status).toBe(422);
    expect((await score(ana, 'pit_floor', { heroId: heroIds['Lyra'], score: 10, build: buildAt(1) })).status).toBe(422);
    expect((await score(bo, 'pit_floor', { heroId: heroIds['Kriso'], score: 99, build: buildAt(9) })).status).toBe(404);
    expect((await score(ana, 'pit_floor', { heroId: heroIds['Kriso'], score: 70, build: { ...buildAt(5), gear: [{ slot: 'Nose' }] } })).status).toBe(400);
    expect((await post('/api/leaderboards/pit_floor/scores', undefined, { heroId: heroIds['Kriso'], score: 1, build: buildAt(1) })).status).toBe(401);
  });

  it('flags a score its save contradicts, keeping it off the board', async () => {
    const save = saveOf([{ id: 3, name: 'Kriso', class: 'Barbarian', level: 60, highestChartTier: 10 }]);
    const flagged = await score(ana, 'chart_tier', { heroId: heroIds['Kriso'], score: 12, build: buildAt(1), save, saveHeroId: 3 });

    expect(flagged.body.entry).toMatchObject({ verdict: 'flagged', verdictNote: "the save's highest chart tier is 10", rank: null });
    expect((await get<BoardPage>('/api/leaderboards/chart_tier')).body.entries.data).toEqual([]);

    const unreadable = await score(bo, 'chart_tier', { heroId: heroIds['Mott'], score: 3, build: buildAt(1), save: 'garbage', saveHeroId: 1 });
    expect(unreadable.body.entry.verdict).toBe('flagged');
  });
});

describe('reading a board', () => {
  it('shows the top with ranks, players, heroes and every row whole build', async () => {
    const page = await get<BoardPage>('/api/leaderboards/pit_floor');

    expect(page.status).toBe(200);
    expect(page.body.board).toMatchObject({ key: 'pit_floor', title: 'Deepest Bone Pit floor', hardcore: false, sort: 'desc' });
    const rows = page.body.entries.data;
    expect(rows.map((r) => [r.rank, r.hero.name, r.score, r.player.displayName])).toEqual([
      [1, 'Kriso', 60, 'Ana'],
      [2, 'Mott', 55, 'Bodhi'],
      [3, 'Vex', 40, 'Cyra'],
    ]);
    expect(rows[0]?.build).toMatchObject({ revision: 2, dps: 3_000 });
    expect(rows[0]?.build.skills[0]).toMatchObject({ id: 'cleave', supports: [{ id: 'brutality', level: 15 }, { id: 'melee_splash', level: 12 }] });
    expect(rows[0]?.build.gear[0]?.lines).toHaveLength(3);
    expect(rows[0]?.build.talents).toEqual({ allocated: ['might_1', 'might_2', 'cleave_mastery'], ascendancy: ['berserker_rage'] });
  });

  it('pages with a cursor, ranks carrying on, and back again', async () => {
    const first = await get<BoardPage>('/api/leaderboards/pit_floor?take=2');
    expect(first.body.entries.data.map((r) => r.rank)).toEqual([1, 2]);
    expect(first.body.entries.meta).toMatchObject({ hasNextPage: true, hasPreviousPage: false });

    const second = await get<BoardPage>(`/api/leaderboards/pit_floor?take=2&cursor=${first.body.entries.meta.nextCursor}`);
    expect(second.body.entries.data.map((r) => [r.rank, r.hero.name])).toEqual([[3, 'Vex']]);
    expect(second.body.entries.meta).toMatchObject({ hasNextPage: false, hasPreviousPage: true });

    const back = await get<BoardPage>(`/api/leaderboards/pit_floor?take=2&direction=backward&cursor=${second.body.entries.meta.previousCursor}`);
    expect(back.body.entries.data.map((r) => r.rank)).toEqual([1, 2]);
    expect((await get('/api/leaderboards/pit_floor?cursor=not-a-cursor')).status).toBe(400);
  });

  it('shows the caller and their friends only, when asked', async () => {
    const friends = await get<BoardPage>('/api/leaderboards/pit_floor?view=friends', ana);

    expect(friends.body.entries.data.map((r) => [r.rank, r.hero.name])).toEqual([
      [1, 'Kriso'],
      [2, 'Mott'],
    ]);
    expect((await get('/api/leaderboards/pit_floor?view=friends')).status).toBe(401);
  });

  it('filters by class', async () => {
    const rangers = await get<BoardPage>('/api/leaderboards/pit_floor?class=ranger');

    expect(rangers.body.entries.data.map((r) => [r.rank, r.hero.name])).toEqual([[1, 'Mott']]);
  });

  it("gives the caller's rank with the rows around it", async () => {
    const mine = await get<{ entry: Entry | null; neighbours: Entry[] }>('/api/leaderboards/pit_floor/me?around=1', cy);

    expect(mine.status).toBe(200);
    expect(mine.body.entry).toMatchObject({ rank: 3, hero: { name: 'Vex' } });
    expect(mine.body.neighbours.map((r) => [r.rank, r.hero.name])).toEqual([
      [2, 'Mott'],
      [3, 'Vex'],
    ]);
    const nobody = await signUp(base, 'Newcomer', 'new@boards.test');
    expect((await get<{ entry: Entry | null }>('/api/leaderboards/pit_floor/me', nobody)).body.entry).toBeNull();
  });

  it('keeps the hardcore twin apart, by its key or the hardcore filter', async () => {
    const posted = await score(ana, 'hc_pit_floor', { heroId: heroIds['Lyra'], score: 12, build: buildAt(1) });
    expect(posted.body.entry.rank).toBe(1);

    const byKey = await get<BoardPage>('/api/leaderboards/hc_pit_floor');
    const byFilter = await get<BoardPage>('/api/leaderboards/pit_floor?hardcore=true');
    expect(byKey.body.board).toMatchObject({ title: 'Hardcore deepest Bone Pit floor', hardcore: true });
    expect(byKey.body.entries.data.map((r) => r.hero.name)).toEqual(['Lyra']);
    expect(byFilter.body.entries.data.map((r) => r.hero.name)).toEqual(['Lyra']);
    expect((await get<BoardPage>('/api/leaderboards/pit_floor')).body.entries.data.map((r) => r.hero.name)).not.toContain('Lyra');
  });

  it('ranks a time board smallest first', async () => {
    await score(ana, 'map_s16', { heroId: heroIds['Kriso'], score: 400_000, build: buildAt(2, 62, 3_000) });
    await score(bo, 'map_s16', { heroId: heroIds['Mott'], score: 350_000, build: buildAt(1) });

    const page = await get<BoardPage>('/api/leaderboards/map_s16');
    expect(page.body.entries.data.map((r) => [r.rank, r.hero.name, r.score])).toEqual([
      [1, 'Mott', 350_000],
      [2, 'Kriso', 400_000],
    ]);
  });

  it('hides a private profile from everyone but its owner', async () => {
    await call(base, 'PATCH', '/api/profile', { token: cy.token, body: { publicProfile: false } });

    const seen = (await get<BoardPage>('/api/leaderboards/pit_floor', bo)).body.entries.data.find((r) => r.hero.name === 'Vex');
    expect(seen?.player).toEqual({ userId: null, displayName: 'A hidden player', hidden: true });
    const own = (await get<BoardPage>('/api/leaderboards/pit_floor', cy)).body.entries.data.find((r) => r.hero.name === 'Vex');
    expect(own?.player).toMatchObject({ displayName: 'Cyra', hidden: false });
    await call(base, 'PATCH', '/api/profile', { token: cy.token, body: { publicProfile: true } });
  });
});

describe('accounts and the boards', () => {
  it("moves a guest's heroes and places, and its chosen name, to the account it becomes", async () => {
    const visitor = await guest(base);
    await call(base, 'PATCH', '/api/profile', { token: visitor.token, body: { displayName: 'Wanderer' } });
    const hero = await post<{ hero: { id: string } }>('/api/heroes', visitor, { name: 'Ash', class: 'ranger' });
    await score(visitor, 'pit_floor', { heroId: hero.body.hero.id, score: 45, build: buildAt(1) });

    const signUpReply = await post('/api/auth/sign-up/email', visitor, { email: 'wanderer@boards.test', password: 'a long enough password', name: 'W' });
    expect(signUpReply.status).toBe(200);
    const account = { token: signUpReply.token ?? '', id: '', displayName: '' };

    expect((await get<{ heroes: { id: string }[] }>('/api/heroes', account)).body.heroes.map((h) => h.id)).toEqual([hero.body.hero.id]);
    expect((await get<{ displayName: string }>('/api/profile', account)).body.displayName).toBe('Wanderer');
    const row = (await get<BoardPage>('/api/leaderboards/pit_floor')).body.entries.data.find((r) => r.hero.name === 'Ash');
    expect(row?.player.displayName).toBe('Wanderer');
  });

  it('takes a deleted player off every board, with their heroes and builds', async () => {
    const kriso = (await get<BoardPage>('/api/leaderboards/pit_floor')).body.entries.data.find((r) => r.hero.name === 'Kriso');
    expect(kriso).toBeDefined();

    expect((await post('/api/account/delete', ana, { password: 'a long enough password' })).status).toBe(200);

    const names = (await get<BoardPage>('/api/leaderboards/pit_floor')).body.entries.data.map((r) => r.hero.name);
    expect(names).not.toContain('Kriso');
    expect(names[0]).toBe('Mott');
    expect((await get(`/api/builds/${kriso?.build.id}`)).status).toBe(404);
    expect((await get<BoardPage>('/api/leaderboards/hc_pit_floor')).body.entries.data).toEqual([]);
  });
});
