import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AVATAR_PORTRAITS } from '@gravoth/contracts';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { MIGRATIONS_FOLDER } from './database/migrations.js';
import { createTestDatabase, type TestDatabase } from './testing/database.js';

/**
 * A migration that changes rows already there, run over rows made before it: the database is migrated to the one
 * before (a copy of drizzle/ whose journal stops there), given players, then migrated the rest of the way.
 */
let database: TestDatabase;
let client: SQL;
let folder: string;

/** drizzle/ as it was before the migration tagged `tag`. */
const migrationsBefore = async (tag: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'gravoth-migrations-'));
  await cp(MIGRATIONS_FOLDER, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = (await Bun.file(journalPath).json()) as {
    entries: { tag: string }[];
  };
  const at = journal.entries.findIndex((entry) => entry.tag === tag);
  if (at < 0) throw new Error(`no migration ${tag}`);
  await Bun.write(
    journalPath,
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }),
  );
  return dir;
};

beforeAll(async () => {
  database = await createTestDatabase();
  client = new SQL(database.url, { max: 1 });
  folder = await migrationsBefore('0002_profile_avatars');
});

afterAll(async () => {
  await client.close();
  await database.drop();
  await rm(folder, { recursive: true, force: true });
});

describe('0002 and 0003, the profile pictures', () => {
  it('gives every existing profile its own portrait, and the photo to those whose sign-in has one', async () => {
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder: folder });

    const players = [
      ['Gia', 'https://lh3.googleusercontent.com/a/gia=s96-c'],
      ['Dax', 'https://cdn.discordapp.com/avatars/7/dax.png'],
      ['Def', 'https://cdn.discordapp.com/embed/avatars/1.png'],
      ['Nop', null],
      ['Odd', 'https://example.test/odd.png'],
    ] as const;
    for (const [name, image] of players) {
      await client`INSERT INTO users (name, email, image) VALUES (${name}, ${`${name.toLowerCase()}@migrate.test`}, ${image})`;
    }
    // Enough profiles that a shared default would show: forty more without a photo.
    for (let n = 0; n < 40; n++) {
      await client`INSERT INTO users (name, email) VALUES (${`P${n}`}, ${`p${n}@migrate.test`})`;
    }
    await client`INSERT INTO profiles (user_id, display_name) SELECT id, name || '_x' FROM users`;

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const rows = (await client`
      SELECT u.name, p.avatar_kind, p.avatar_portrait, p.avatar_chosen
      FROM profiles p JOIN users u ON u.id = p.user_id`) as {
      name: string;
      avatar_kind: string;
      avatar_portrait: string;
      avatar_chosen: boolean;
    }[];
    const kind = Object.fromEntries(rows.map((r) => [r.name, r.avatar_kind]));
    expect(kind).toMatchObject({
      Gia: 'provider',
      Dax: 'provider',
      Def: 'portrait',
      Nop: 'portrait',
      Odd: 'portrait',
    });
    for (const row of rows) {
      expect(AVATAR_PORTRAITS as readonly string[]).toContain(
        row.avatar_portrait,
      );
      expect(row.avatar_chosen).toBe(false);
    }
    expect(new Set(rows.map((r) => r.avatar_portrait)).size).toBeGreaterThan(5);
  });
});
