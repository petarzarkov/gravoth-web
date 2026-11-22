import { describe, expect, test } from 'bun:test';
import {
  ActiveHeroes,
  AVATAR_BORDERS,
  AVATAR_BORDER_NAMES,
  AVATAR_IMAGE_SOURCES,
  AVATAR_PORTRAITS,
  AdminChatQuery,
  AroundMe,
  BOARDS,
  CHAT_LIMITS,
  ChatQuery,
  ERROR_CODES,
  MarkRead,
  MutePlayer,
  REPORT_REASONS,
  ReportMessage,
  ReportsQuery,
  ResolveReport,
  SendMessage,
  BuildSnapshot,
  CLOUD_SAVE_MAX_BASE64,
  CLOUD_SAVE_MAX_BYTES,
  CloudSaveRead,
  CloudSaveWrite,
  DISPLAY_NAME_PATTERN,
  HARDCORE_PREFIX,
  MAX_ACTIVE_HEROES,
  PostHeroBuild,
  REALM_LEASE_SECONDS,
  REALM_REASONS,
  ReadBoard,
  RealmLease,
  RealmRelease,
  RealmWrite,
  RegisterHero,
  UpdateProfile,
  avatarBorderOf,
  hardcoreTitle,
} from './index.js';

const build = {
  revision: 3,
  gameVersion: '0.12.0',
  level: 71,
  skills: [
    {
      id: 'cleave',
      level: 18,
      slot: 0,
      supports: [{ id: 'melee_phys', level: 15 }],
    },
  ],
  gear: [
    {
      slot: 'MainHand',
      name: 'Grief Cleaver',
      base: 'Great Axe',
      rarity: 'Rare',
      itemLevel: 70,
      lines: [{ text: '+42 to Strength', kind: 'suffix', tier: 2 }],
    },
  ],
  talents: { allocated: [1, 4, 9] },
  summary: { dps: 12_345.6, clearDps: 9_800, ehp: 31_000, life: 4_200 },
};

describe('BuildSnapshot', () => {
  test('fills the defaults a game build leaves out', () => {
    const parsed = BuildSnapshot.parse(build);
    expect(parsed.ascendancy).toBeNull();
    expect(parsed.auras).toEqual([]);
    expect(parsed.atlas).toEqual({});
    expect(parsed.summary.energyShield).toBe(0);
  });

  test('keeps extra numbers on the sheet', () => {
    const parsed = BuildSnapshot.parse({
      ...build,
      summary: { ...build.summary, attackSpeed: 1.7 },
    });
    expect(parsed.summary['attackSpeed']).toBe(1.7);
  });

  test('refuses an unknown slot, rarity or version', () => {
    const gear = build.gear[0];
    expect(
      BuildSnapshot.safeParse({ ...build, gear: [{ ...gear, slot: 'Tail' }] })
        .success,
    ).toBe(false);
    expect(
      BuildSnapshot.safeParse({
        ...build,
        gear: [{ ...gear, rarity: 'Legendary' }],
      }).success,
    ).toBe(false);
    expect(
      BuildSnapshot.safeParse({ ...build, gameVersion: 'latest' }).success,
    ).toBe(false);
  });

  test("takes the game's own ranges: gems and auras to 60, items to level 130", () => {
    const skill = build.skills[0];
    const gear = build.gear[0];
    const ok = BuildSnapshot.safeParse({
      ...build,
      skills: [
        { ...skill, level: 60, supports: [{ id: 'melee_phys', level: 60 }] },
      ],
      gear: [{ ...gear, itemLevel: 130 }],
      auras: [{ id: 'anger', level: 60 }],
    });
    expect(ok.success).toBe(true);
    expect(
      BuildSnapshot.safeParse({ ...build, skills: [{ ...skill, level: 61 }] })
        .success,
    ).toBe(false);
    expect(
      BuildSnapshot.safeParse({
        ...build,
        gear: [{ ...gear, itemLevel: 131 }],
      }).success,
    ).toBe(false);
  });

  test('bounds the free-form documents', () => {
    const huge = { blob: 'x'.repeat(40_000) };
    expect(BuildSnapshot.safeParse({ ...build, talents: huge }).success).toBe(
      false,
    );
  });
});

describe('boards', () => {
  test('keys are unique and fit the path rule, hardcore twin included', () => {
    const keys = BOARDS.map((board) => board.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(ReadBoard.shape).toBeDefined();
      expect(/^[a-z][a-z0-9_]{1,42}$/.test(`${HARDCORE_PREFIX}${key}`)).toBe(
        true,
      );
    }
  });

  test('a hardcore title reads as a sentence', () => {
    expect(hardcoreTitle('Deepest Bone Pit floor')).toBe(
      'Hardcore deepest Bone Pit floor',
    );
  });

  test('a board read pages forwards by default, the whole board, season 0', () => {
    const query = ReadBoard.parse({});
    expect(query).toMatchObject({
      take: 20,
      direction: 'forward',
      season: 0,
      view: 'all',
    });
    expect(ReadBoard.parse({ hardcore: 'true' }).hardcore).toBe(true);
    expect(AroundMe.parse({}).around).toBe(5);
    expect(ReadBoard.safeParse({ take: '500' }).success).toBe(false);
  });
});

describe('players', () => {
  test('display names: 3 to 20, starting with a letter or digit', () => {
    for (const ok of ['Ana', 'sol_99', '7th-son', 'A'.repeat(20)]) {
      expect(DISPLAY_NAME_PATTERN.test(ok)).toBe(true);
    }
    for (const bad of ['Al', '_ana', 'a b c', 'A'.repeat(21), 'émile']) {
      expect(DISPLAY_NAME_PATTERN.test(bad)).toBe(false);
    }
    expect(UpdateProfile.safeParse({ displayName: '-x-' }).success).toBe(false);
  });

  test('a picture is the sign-in photo or a portrait by id', () => {
    expect(UpdateProfile.parse({ avatar: 'provider' }).avatar).toBe('provider');
    expect(UpdateProfile.parse({ avatar: 'gravelord' }).avatar).toBe(
      'gravelord',
    );
    expect(UpdateProfile.safeParse({ avatar: 'Gravelord' }).success).toBe(
      false,
    );
    expect(UpdateProfile.safeParse({ avatar: 'nobody' }).success).toBe(false);
  });

  test('the portraits are 42 distinct ids, as the game numbers them', () => {
    expect(AVATAR_PORTRAITS).toHaveLength(42);
    expect(new Set(AVATAR_PORTRAITS).size).toBe(42);
    expect(AVATAR_PORTRAITS[0]).toBe('warden');
    expect(AVATAR_PORTRAITS[41]).toBe('oathspeaker');
    for (const id of AVATAR_PORTRAITS) expect(id).toMatch(/^[a-z][a-z_]*$/);
    for (const source of AVATAR_IMAGE_SOURCES)
      expect(source).toMatch(/^https:\/\/[a-z0-9.*-]+$/);
  });

  test("the avatar borders are the game's 13 keys, worst to best, each named", () => {
    expect(AVATAR_BORDERS).toHaveLength(13);
    expect(new Set(AVATAR_BORDERS).size).toBe(13);
    expect(AVATAR_BORDERS[0]).toBe('pit_30');
    expect(AVATAR_BORDERS[12]).toBe('pinnacle_gold');
    expect(Object.keys(AVATAR_BORDER_NAMES).sort()).toEqual(
      [...AVATAR_BORDERS].sort(),
    );
    expect(avatarBorderOf('hall_gold_4')).toBe('hall_gold_4');
    for (const unknown of ['', 'HALL_GOLD', 'pit_99', '../x', 7, null])
      expect(avatarBorderOf(unknown)).toBeNull();
  });

  test('a hero class is read in any case', () => {
    expect(RegisterHero.parse({ name: 'Ash', class: 'Barbarian' }).class).toBe(
      'barbarian',
    );
    expect(
      RegisterHero.safeParse({ name: 'Ash', class: 'Necromancer' }).success,
    ).toBe(false);
  });
});

describe("players' heroes", () => {
  test('a hero build is a BuildSnapshot, with an optional save and the hero in it', () => {
    expect(PostHeroBuild.safeParse({ build }).success).toBe(true);
    expect(
      PostHeroBuild.safeParse({ build, save: 'x', saveHeroId: 2 }).success,
    ).toBe(true);
    expect(PostHeroBuild.safeParse({ build: { level: 3 } }).success).toBe(
      false,
    );
    expect(PostHeroBuild.safeParse({ build, saveHeroId: -1 }).success).toBe(
      false,
    );
    expect(
      PostHeroBuild.safeParse({ build, save: 'x'.repeat(2_000_001) }).success,
    ).toBe(false);
  });

  test('the active heroes are uuids, at most 64', () => {
    const id = '0b7c5f3e-8f3a-4a52-9a43-4f6f6e2a1b11';
    expect(ActiveHeroes.parse({ heroIds: [] }).heroIds).toEqual([]);
    expect(ActiveHeroes.safeParse({ heroIds: [id] }).success).toBe(true);
    expect(ActiveHeroes.safeParse({ heroIds: ['x'] }).success).toBe(false);
    expect(
      ActiveHeroes.safeParse({
        heroIds: Array.from({ length: MAX_ACTIVE_HEROES + 1 }, () => id),
      }).success,
    ).toBe(false);
  });
});

describe('cloud saves', () => {
  test('a write fills its defaults and takes only base64 data', () => {
    expect(CloudSaveWrite.parse({ data: 'AAD/' })).toEqual({
      data: 'AAD/',
      description: '',
      playSeconds: 0,
    });
    for (const data of ['AAA', 'AA AA', 'AA-_', '=AAA', 'AAAA=A'])
      expect(CloudSaveWrite.safeParse({ data }).success).toBe(false);
    expect(
      CloudSaveWrite.safeParse({ data: 'AAAA', gameVersion: '0.13.1' }).success,
    ).toBe(true);
    for (const gameVersion of ['0.13', '0.13.1-preview', '1234.0.0'])
      expect(
        CloudSaveWrite.safeParse({ data: 'AAAA', gameVersion }).success,
      ).toBe(false);
    expect(
      CloudSaveWrite.safeParse({ data: 'AAAA', description: 'x'.repeat(201) })
        .success,
    ).toBe(false);
    expect(
      CloudSaveWrite.safeParse({ data: 'AAAA', playSeconds: 1.5 }).success,
    ).toBe(false);
  });

  test('the longest data decodes to exactly the largest save', () => {
    expect(CLOUD_SAVE_MAX_BASE64).toBe(4_000_000);
    expect((CLOUD_SAVE_MAX_BASE64 / 4) * 3).toBe(CLOUD_SAVE_MAX_BYTES);
    const longest = 'A'.repeat(CLOUD_SAVE_MAX_BASE64);
    expect(CloudSaveWrite.safeParse({ data: longest }).success).toBe(true);
    expect(CloudSaveWrite.safeParse({ data: `${longest}AAAA` }).success).toBe(
      false,
    );
  });

  test('a read carries the data unless ?data=false', () => {
    expect(CloudSaveRead.parse({}).data).toBe(true);
    expect(CloudSaveRead.parse({ data: 'false' }).data).toBe(false);
    expect(CloudSaveRead.safeParse({ data: 'maybe' }).success).toBe(false);
  });
});

describe('the online realm', () => {
  const write = {
    deviceId: 'phone-1',
    baseRevision: 3,
    data: 'AAD/',
    reason: 'checkpoint' as const,
  };

  test('an upload names its device, revision, data and reason; transfers default to none', () => {
    expect(RealmWrite.parse(write)).toEqual({ ...write, transferred: [] });
    expect(
      RealmWrite.parse({ ...write, reason: 'transfer', transferred: [2, 3] })
        .transferred,
    ).toEqual([2, 3]);
    expect(REALM_REASONS).toEqual([
      'checkpoint',
      'interval',
      'pause',
      'transfer',
      'create',
    ]);
    for (const bad of [
      { ...write, reason: 'teleport' },
      { ...write, baseRevision: -1 },
      { ...write, data: 'AA AA' },
      { ...write, deviceId: '' },
      { ...write, deviceId: 'x'.repeat(129) },
      { ...write, transferred: [-1] },
    ])
      expect(RealmWrite.safeParse(bad).success).toBe(false);
  });

  test('a lease is not forced unless asked, and lasts five minutes', () => {
    expect(RealmLease.parse({ deviceId: 'phone-1' })).toEqual({
      deviceId: 'phone-1',
      force: false,
    });
    expect(RealmRelease.safeParse({}).success).toBe(false);
    expect(REALM_LEASE_SECONDS).toBe(300);
  });
});

describe('chat', () => {
  test('a message is trimmed text of 1 to 300 characters', () => {
    expect(SendMessage.parse({ body: '  hello  ' }).body).toBe('hello');
    expect(SendMessage.safeParse({ body: '   ' }).success).toBe(false);
    expect(SendMessage.safeParse({ body: 'x'.repeat(301) }).success).toBe(
      false,
    );
    expect(
      SendMessage.safeParse({ body: ` ${'x'.repeat(300)} ` }).success,
    ).toBe(true);
    expect(CHAT_LIMITS.MAX_BODY).toBe(300);
  });

  test('a page takes 50 by default and 100 at most, after or before an id', () => {
    expect(ChatQuery.parse({})).toEqual({ take: 50 });
    expect(ChatQuery.parse({ after: '0', take: '5' })).toEqual({
      after: 0,
      take: 5,
    });
    expect(ChatQuery.safeParse({ take: '101' }).success).toBe(false);
    expect(ChatQuery.safeParse({ before: '0' }).success).toBe(false);
    expect(MarkRead.safeParse({ upTo: -1 }).success).toBe(false);
    expect(AdminChatQuery.parse({ around: '7' })).toEqual({
      around: 7,
      take: 50,
    });
    expect(AdminChatQuery.safeParse({ userId: 'nobody' }).success).toBe(false);
  });

  test('a report names one of the reasons, with a short note', () => {
    expect(REPORT_REASONS).toEqual([
      'spam',
      'harassment',
      'hate',
      'sexual',
      'cheating',
      'other',
    ]);
    expect(ReportMessage.parse({ reason: 'spam' })).toEqual({ reason: 'spam' });
    expect(ReportMessage.safeParse({ reason: 'rude' }).success).toBe(false);
    expect(
      ReportMessage.safeParse({ reason: 'other', note: 'x'.repeat(201) })
        .success,
    ).toBe(false);
    expect(ReportsQuery.parse({})).toEqual({ state: 'open', take: 50 });
  });

  test('a mute needs its hours, ten years at most', () => {
    expect(ResolveReport.safeParse({ action: 'dismiss' }).success).toBe(true);
    expect(ResolveReport.safeParse({ action: 'mute' }).success).toBe(false);
    expect(ResolveReport.safeParse({ action: 'mute', hours: 24 }).success).toBe(
      true,
    );
    const player = '00000000-0000-4000-8000-000000000001';
    expect(MutePlayer.parse({ userId: player, hours: 1 }).reason).toBe('');
    expect(
      MutePlayer.safeParse({
        userId: player,
        hours: CHAT_LIMITS.MAX_MUTE_HOURS + 1,
      }).success,
    ).toBe(false);
  });

  test('its error codes are listed', () => {
    for (const code of [
      'TOO_MANY_REQUESTS',
      'CHAT_RULES',
      'CHAT_MUTED',
      'CHAT_REPEAT',
      'MESSAGE_NOT_ALLOWED',
      'LINKS_NOT_ALLOWED',
      'NOT_FRIENDS',
      'MESSAGE_NOT_FOUND',
      'CANNOT_REPORT_SELF',
      'REPORT_NOT_FOUND',
      'MUTE_NOT_FOUND',
    ])
      expect(ERROR_CODES as readonly string[]).toContain(code);
  });
});

describe('constants', () => {
  test('carry no schema library, so the website bundle stays small', async () => {
    const source = await Bun.file(`${import.meta.dir}/constants.ts`).text();
    expect(source).not.toMatch(/from ['"]/);
  });
});
