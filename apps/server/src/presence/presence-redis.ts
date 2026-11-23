import { within, type OnShutdown } from '@dunx/core';
import { AppConfigService } from '../config.js';

/** How long a connection attempt may take, and how long a read waits for its answer. */
const CONNECT_TIMEOUT_MS = 500;
const READ_TIMEOUT_MS = 500;
/** While Redis is down, at most one connection attempt per this; the commands between fail at once. */
const RECONNECT_MS = 5_000;

/**
 * Presence's own connection to Redis (`REDIS_URL`), apart from the cache's. `Bun.RedisClient` with no retries never
 * reconnects once its connection drops (a Redis restart leaves it closed until the app restarts), so this one connects
 * again itself when a command finds it down, at most once every `RECONNECT_MS`. Never in a request's way: an attempt
 * takes at most `CONNECT_TIMEOUT_MS`, a read waits `READ_TIMEOUT_MS`, and between attempts a command fails at once.
 */
export class PresenceRedis implements OnShutdown {
  readonly #client: Bun.RedisClient;
  #retryAt = 0;
  #connecting: Promise<void> | undefined;

  constructor(config: AppConfigService) {
    const { url } = config.get('redis');
    // No url: Bun's own chain ($VALKEY_URL, $REDIS_URL, then localhost), as the cache's connection.
    const options = { connectionTimeout: CONNECT_TIMEOUT_MS, maxRetries: 0 };
    this.#client =
      url === undefined
        ? new Bun.RedisClient(undefined, options)
        : new Bun.RedisClient(url, options);
  }

  /** `SET key 1 EX seconds`. */
  async set(key: string, seconds: number): Promise<void> {
    await this.#ready();
    await this.#client.set(key, '1', 'EX', seconds);
  }

  /** `MGET keys...`, one value (or null) per key. */
  async mget(keys: readonly string[]): Promise<readonly (string | null)[]> {
    await this.#ready();
    return within(this.#client.mget(...keys), READ_TIMEOUT_MS, () => {
      throw new Error(`MGET: no answer in ${READ_TIMEOUT_MS} ms`);
    });
  }

  onShutdown(): void {
    this.#client.close();
  }

  /** Connected, or connecting now when the last attempt is `RECONNECT_MS` old; otherwise a failure at once. */
  async #ready(): Promise<void> {
    if (this.#client.connected) return;
    if (this.#connecting === undefined) {
      const now = Date.now();
      if (now < this.#retryAt) throw new Error('redis is down');
      this.#retryAt = now + RECONNECT_MS;
      this.#connecting = this.#client.connect().finally(() => {
        this.#connecting = undefined;
      });
    }
    await this.#connecting;
  }
}
