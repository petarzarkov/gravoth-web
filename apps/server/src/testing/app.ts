import type { ConfigSource, Registration } from '@dunx/core';
import type { HttpApp } from '@dunx/http';
import { createApp } from '../main.js';
import { createTestDatabase, type TestDatabase } from './database.js';

export interface TestApp {
  readonly app: HttpApp;
  /** `http://127.0.0.1:<port>`, no trailing slash. */
  readonly base: string;
  readonly database: TestDatabase;
  close(): Promise<void>;
}

/** The real app on port 0, over a database of its own (testing/database.ts). */
export const startTestApp = async (
  options: { overrides?: readonly Registration[]; config?: ConfigSource } = {},
): Promise<TestApp> => {
  const database = await createTestDatabase();
  const app = await createApp({
    ...(options.overrides === undefined
      ? {}
      : { overrides: options.overrides }),
    // The suites describe decision 227's boards (online heroes only) unless one says otherwise.
    config: {
      BOARDS_ONLINE_ONLY: 'true',
      ...options.config,
      DATABASE_URL: database.url,
    },
  });
  const base = new URL(await app.listen(0)).origin;
  return {
    app,
    base,
    database,
    close: async () => {
      await app.shutdown();
      await database.drop();
    },
  };
};
