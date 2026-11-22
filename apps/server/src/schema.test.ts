import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { Db } from './database/db.js';
import {
  checkViolation,
  isForeignKeyViolation,
  isUniqueViolation,
  sqlState,
} from './database/errors.js';
import {
  account,
  block,
  friendship,
  hero,
  heroBuild,
  leaderboard,
  leaderboardEntry,
  profile,
  session,
  user,
} from './database/schema.js';
import { startTestApp, type TestApp } from './testing/app.js';

/**
 * The database's own rules, straight through the drizzle handle (no route in between), so each one is shown to hold
 * by itself: the keys, the unique and check constraints, the immutable builds, and what a deleted user takes along.
 */
let started: TestApp;
let db: Db;

beforeAll(async () => {
  started = await startTestApp();
  db = started.app.get(Db);
});

afterAll(async () => {
  await started.close();
});

const failure = async (work: Promise<unknown>): Promise<unknown> => {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error('expected the database to refuse this');
};

let counter = 0;
const newUser = async (name = 'Player') => {
  counter += 1;
  const [row] = await db
    .insert(user)
    .values({ name, email: `player${counter}@schema.test` })
    .returning();
  if (row === undefined) throw new Error('no user');
  await db
    .insert(profile)
    .values({ userId: row.id, displayName: `${name}${counter}` });
  return row;
};

const buildValues = (heroId: string, revision: number) => ({
  heroId,
  revision,
  gameVersion: '0.12.0',
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
  contentHash: revision.toString(16).padStart(64, '0'),
});

const pitFloor = async () => {
  const [board] = await db
    .select()
    .from(leaderboard)
    .where(
      and(eq(leaderboard.key, 'pit_floor'), eq(leaderboard.hardcore, false)),
    )
    .limit(1);
  if (board === undefined) throw new Error('no board');
  return board;
};

describe('users and their sign-ins', () => {
  it('keeps one lowercase address per user', async () => {
    const a = await newUser();
    expect(
      isUniqueViolation(
        await failure(db.insert(user).values({ name: 'Copy', email: a.email })),
        'users_email_key',
      ),
    ).toBe(true);
    expect(
      checkViolation(
        await failure(
          db.insert(user).values({ name: 'Loud', email: 'LOUD@schema.test' }),
        ),
      ),
    ).toBe('users_email_lowercase');
  });

  it('links each provider once per user, and each provider identity to one user', async () => {
    const a = await newUser();
    const b = await newUser();
    await db
      .insert(account)
      .values({ userId: a.id, providerId: 'google', accountId: 'g-1' });

    expect(
      isUniqueViolation(
        await failure(
          db
            .insert(account)
            .values({ userId: a.id, providerId: 'google', accountId: 'g-2' }),
        ),
        'accounts_user_provider_key',
      ),
    ).toBe(true);
    expect(
      isUniqueViolation(
        await failure(
          db
            .insert(account)
            .values({ userId: b.id, providerId: 'google', accountId: 'g-1' }),
        ),
        'accounts_provider_account_key',
      ),
    ).toBe(true);
    expect(
      checkViolation(
        await failure(
          db.insert(account).values({
            userId: b.id,
            providerId: 'discord',
            accountId: 'd-1',
            password: 'hash',
          }),
        ),
      ),
    ).toBe('accounts_password_only_credential');
  });
});

describe('profiles', () => {
  it('holds display names unique without regard to case, and to the format', async () => {
    const a = await newUser();
    const b = await newUser();
    await db
      .update(profile)
      .set({ displayName: 'Taken' })
      .where(eq(profile.userId, a.id));

    expect(
      isUniqueViolation(
        await failure(
          db
            .update(profile)
            .set({ displayName: 'TAKEN' })
            .where(eq(profile.userId, b.id)),
        ),
        'profiles_display_name_key',
      ),
    ).toBe(true);
    expect(
      checkViolation(
        await failure(
          db
            .update(profile)
            .set({ displayName: 'no spaces here' })
            .where(eq(profile.userId, b.id)),
        ),
      ),
    ).toBe('profiles_display_name_format');
    expect(
      checkViolation(
        await failure(
          db
            .update(profile)
            .set({ displayName: '_x' })
            .where(eq(profile.userId, b.id)),
        ),
      ),
    ).toBe('profiles_display_name_format');
  });
});

describe('friendships and blocks', () => {
  it('keeps one row per pair, whichever of the two asked', async () => {
    const a = await newUser();
    const b = await newUser();
    await db
      .insert(friendship)
      .values({ requesterId: a.id, addresseeId: b.id });

    expect(
      isUniqueViolation(
        await failure(
          db
            .insert(friendship)
            .values({ requesterId: a.id, addresseeId: b.id }),
        ),
        'friendships_pair_key',
      ),
    ).toBe(true);
    expect(
      isUniqueViolation(
        await failure(
          db
            .insert(friendship)
            .values({ requesterId: b.id, addresseeId: a.id }),
        ),
        'friendships_pair_key',
      ),
    ).toBe(true);
  });

  it('refuses befriending or blocking oneself', async () => {
    const a = await newUser();

    expect(
      checkViolation(
        await failure(
          db
            .insert(friendship)
            .values({ requesterId: a.id, addresseeId: a.id }),
        ),
      ),
    ).toBe('friendships_not_self');
    expect(
      checkViolation(
        await failure(
          db.insert(block).values({ blockerId: a.id, blockedId: a.id }),
        ),
      ),
    ).toBe('blocks_not_self');
  });

  it('has a response time exactly when accepted', async () => {
    const a = await newUser();
    const b = await newUser();
    const c = await newUser();

    expect(
      checkViolation(
        await failure(
          db.insert(friendship).values({
            requesterId: a.id,
            addresseeId: b.id,
            status: 'accepted',
          }),
        ),
      ),
    ).toBe('friendships_responded');
    expect(
      checkViolation(
        await failure(
          db.insert(friendship).values({
            requesterId: a.id,
            addresseeId: c.id,
            respondedAt: new Date(),
          }),
        ),
      ),
    ).toBe('friendships_responded');
    const blockedStatus = {
      requesterId: b.id,
      addresseeId: c.id,
      status: 'blocked' as 'pending',
      respondedAt: new Date(),
    };
    expect(
      checkViolation(
        await failure(db.insert(friendship).values(blockedStatus)),
      ),
    ).toBe('friendships_status');
  });

  it('refuses a friend who is not a user', async () => {
    const a = await newUser();

    expect(
      isForeignKeyViolation(
        await failure(
          db
            .insert(friendship)
            .values({ requesterId: a.id, addresseeId: crypto.randomUUID() }),
        ),
      ),
    ).toBe(true);
  });
});

describe('heroes, builds and board entries', () => {
  it('keeps a hero name once per player, without regard to case, and only the four classes', async () => {
    const a = await newUser();
    const b = await newUser();
    await db
      .insert(hero)
      .values({ userId: a.id, name: 'Kriso', class: 'barbarian' });

    expect(
      isUniqueViolation(
        await failure(
          db
            .insert(hero)
            .values({ userId: a.id, name: 'kriso', class: 'ranger' }),
        ),
        'heroes_user_name_key',
      ),
    ).toBe(true);
    await db
      .insert(hero)
      .values({ userId: b.id, name: 'Kriso', class: 'barbarian' });
    expect(
      checkViolation(
        await failure(
          db.insert(hero).values({
            userId: b.id,
            name: 'Mage',
            class: 'necromancer' as 'sorcerer',
          }),
        ),
      ),
    ).toBe('heroes_class');
    expect(
      checkViolation(
        await failure(
          db
            .insert(hero)
            .values({ userId: b.id, name: ' Padded ', class: 'ranger' }),
        ),
      ),
    ).toBe('heroes_name_length');
  });

  it('never changes a stored build, and keeps one per hero and revision', async () => {
    const a = await newUser();
    const [mine] = await db
      .insert(hero)
      .values({ userId: a.id, name: 'Vex', class: 'templar' })
      .returning();
    const [build] = await db
      .insert(heroBuild)
      .values(buildValues(mine!.id, 1))
      .returning();

    const refused = await failure(
      db
        .update(heroBuild)
        .set({ level: 99 })
        .where(eq(heroBuild.id, build!.id)),
    );
    expect(sqlState(refused)).toBe('23001');
    expect(
      isUniqueViolation(
        await failure(
          db.insert(heroBuild).values({
            ...buildValues(mine!.id, 1),
            contentHash: 'f'.repeat(64),
          }),
        ),
        'hero_builds_hero_revision_key',
      ),
    ).toBe(true);
    expect(
      checkViolation(
        await failure(
          db.insert(heroBuild).values({
            ...buildValues(mine!.id, 2),
            skills: { not: 'a list' } as never,
          }),
        ),
      ),
    ).toBe('hero_builds_json_shapes');
    expect(
      checkViolation(
        await failure(
          db
            .insert(heroBuild)
            .values({ ...buildValues(mine!.id, 3), level: 101 }),
        ),
      ),
    ).toBe('hero_builds_level');
    // The JSON is stored as documents, not as strings holding them.
    const [stored] = await db.execute<{ kind: string }>(
      sql`SELECT jsonb_typeof(skills) AS kind FROM hero_builds WHERE id = ${build!.id}`,
    );
    expect(stored?.['kind']).toBe('array');
  });

  it('keeps one best per board and hero, from that hero, its owner and its own build', async () => {
    const board = await pitFloor();
    const a = await newUser();
    const b = await newUser();
    const [mine] = await db
      .insert(hero)
      .values({ userId: a.id, name: 'Mott', class: 'ranger' })
      .returning();
    const [theirs] = await db
      .insert(hero)
      .values({ userId: b.id, name: 'Ash', class: 'ranger' })
      .returning();
    const [build] = await db
      .insert(heroBuild)
      .values(buildValues(mine!.id, 1))
      .returning();
    const [otherBuild] = await db
      .insert(heroBuild)
      .values(buildValues(theirs!.id, 1))
      .returning();
    const entry = {
      boardId: board.id,
      userId: a.id,
      heroId: mine!.id,
      buildId: build!.id,
      score: 10,
      achievedAt: new Date(Date.now() - 1000),
    };
    await db.insert(leaderboardEntry).values(entry);

    expect(
      isUniqueViolation(
        await failure(
          db.insert(leaderboardEntry).values({ ...entry, score: 11 }),
        ),
        'leaderboard_entries_board_hero_key',
      ),
    ).toBe(true);
    // Another hero's build, and another player's hero: both refused by the composite keys.
    const hcBoard = (
      await db
        .select()
        .from(leaderboard)
        .where(
          and(eq(leaderboard.key, 'pit_floor'), eq(leaderboard.hardcore, true)),
        )
    )[0]!;
    expect(
      isForeignKeyViolation(
        await failure(
          db
            .insert(leaderboardEntry)
            .values({ ...entry, boardId: hcBoard.id, buildId: otherBuild!.id }),
        ),
      ),
    ).toBe(true);
    expect(
      isForeignKeyViolation(
        await failure(
          db
            .insert(leaderboardEntry)
            .values({ ...entry, boardId: hcBoard.id, userId: b.id }),
        ),
      ),
    ).toBe(true);
    // A build a board row stands on cannot be deleted from under it.
    expect(
      isForeignKeyViolation(
        await failure(db.delete(heroBuild).where(eq(heroBuild.id, build!.id))),
      ),
    ).toBe(true);
    expect(
      checkViolation(
        await failure(
          db.insert(leaderboardEntry).values({
            ...entry,
            boardId: hcBoard.id,
            achievedAt: new Date(Date.now() + 3_600_000),
          }),
        ),
      ),
    ).toBe('leaderboard_entries_achieved');
  });

  it('refuses a board whose range or order makes no sense', async () => {
    expect(
      checkViolation(
        await failure(
          db.insert(leaderboard).values({
            key: 'odd',
            title: 'Odd',
            sort: 'asc',
            format: 'number',
            minScore: 9,
            maxScore: 1,
          }),
        ),
      ),
    ).toBe('leaderboards_range');
    expect(
      checkViolation(
        await failure(
          db.insert(leaderboard).values({
            key: 'hc_twin',
            title: 'Twin',
            sort: 'asc',
            format: 'number',
            minScore: 1,
            maxScore: 9,
          }),
        ),
      ),
    ).toBe('leaderboards_key_format');
  });
});

describe('deleting a user', () => {
  it('takes everything theirs in one statement, and leaves everyone else alone', async () => {
    const board = await pitFloor();
    const gone = await newUser('Gone');
    const stays = await newUser('Stays');
    await db.insert(session).values({
      userId: gone.id,
      token: `t-${gone.id}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await db.insert(account).values({
      userId: gone.id,
      providerId: 'discord',
      accountId: `d-${gone.id}`,
    });
    const [hisHero] = await db
      .insert(hero)
      .values({ userId: gone.id, name: 'Lost', class: 'sorcerer' })
      .returning();
    const [hisBuild] = await db
      .insert(heroBuild)
      .values(buildValues(hisHero!.id, 1))
      .returning();
    await db.insert(leaderboardEntry).values({
      boardId: board.id,
      userId: gone.id,
      heroId: hisHero!.id,
      buildId: hisBuild!.id,
      score: 5,
      achievedAt: new Date(Date.now() - 1000),
    });
    await db
      .insert(friendship)
      .values({ requesterId: stays.id, addresseeId: gone.id });
    await db.insert(block).values({ blockerId: stays.id, blockedId: gone.id });
    const [staysHero] = await db
      .insert(hero)
      .values({ userId: stays.id, name: 'Kept', class: 'sorcerer' })
      .returning();

    await db.delete(user).where(eq(user.id, gone.id));

    const count = async (query: Promise<unknown[]>) => (await query).length;
    expect(
      await count(db.select().from(session).where(eq(session.userId, gone.id))),
    ).toBe(0);
    expect(
      await count(db.select().from(account).where(eq(account.userId, gone.id))),
    ).toBe(0);
    expect(
      await count(db.select().from(profile).where(eq(profile.userId, gone.id))),
    ).toBe(0);
    expect(
      await count(db.select().from(hero).where(eq(hero.userId, gone.id))),
    ).toBe(0);
    expect(
      await count(
        db.select().from(heroBuild).where(eq(heroBuild.heroId, hisHero!.id)),
      ),
    ).toBe(0);
    expect(
      await count(
        db
          .select()
          .from(leaderboardEntry)
          .where(eq(leaderboardEntry.userId, gone.id)),
      ),
    ).toBe(0);
    expect(
      await count(
        db.select().from(friendship).where(eq(friendship.addresseeId, gone.id)),
      ),
    ).toBe(0);
    expect(
      await count(db.select().from(block).where(eq(block.blockedId, gone.id))),
    ).toBe(0);
    expect(
      await count(
        db.select().from(profile).where(eq(profile.userId, stays.id)),
      ),
    ).toBe(1);
    expect(
      await count(db.select().from(hero).where(eq(hero.id, staysHero!.id))),
    ).toBe(1);
  });
});
