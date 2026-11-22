import { SQL } from 'bun';

/**
 * The suites' Postgres: `bun run test` starts it from compose.yml (scripts/test.ts) and passes its address as
 * TEST_DATABASE_URL. Each app a suite boots gets a database of its own, made empty and dropped afterwards, so suites
 * never see each other's rows and a rerun starts clean; the app's own migrations build the schema in it.
 */
export const testServerUrl = (): string => {
  const url = Bun.env['TEST_DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error(
      'TEST_DATABASE_URL is unset: run the suites with `bun run test`, which starts Postgres from compose.yml.',
    );
  }
  return url;
};

export interface TestDatabase {
  readonly url: string;
  readonly name: string;
  drop(): Promise<void>;
}

export const createTestDatabase = async (): Promise<TestDatabase> => {
  const server = testServerUrl();
  const name = `gravoth_test_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const admin = new SQL(server, { max: 1 });
  try {
    // An identifier cannot be a bound parameter; the name is made above, from hex only.
    await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE template0`);
  } finally {
    await admin.close();
  }
  const url = new URL(server);
  url.pathname = `/${name}`;
  return {
    url: url.href,
    name,
    drop: async () => {
      const cleanup = new SQL(server, { max: 1 });
      try {
        await cleanup.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await cleanup.close();
      }
    },
  };
};
