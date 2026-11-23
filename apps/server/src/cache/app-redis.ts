import { Module, within, type OnShutdown } from '@dunx/core';
import type { CacheRedis } from '@dunx/infra/cache';
import { isServerError, RedisError, RedisErrorCode } from '@dunx/infra/redis';
import { AppConfigService } from '../config.js';

/** How long a connection attempt may take, and how long a command waits for its answer. */
const CONNECT_TIMEOUT_MS = 500;
const COMMAND_TIMEOUT_MS = 500;
/** While Redis is down, the wait before the next connection attempt: doubling from the first to the last. */
const RECONNECT_FIRST_MS = 250;
const RECONNECT_MAX_MS = 5_000;

/**
 * The app's one Redis connection: the cache (friend suggestions), the rate limit and presence. Redis is never in a
 * request's way, and the app boots without it.
 *
 * It reconnects itself. `Bun.RedisClient`'s own reconnecting gives up when the server's name stops resolving (a
 * stopped container on Docker's network), and with `maxRetries: 0` it never reconnects at all, which is how a Redis
 * restart used to leave the cache and the rate limit's Redis store dead until the app restarted. So the client has no
 * retries of its own and a command that finds it down connects it first, the wait between failed attempts doubling
 * from `RECONNECT_FIRST_MS` to `RECONNECT_MAX_MS` (reset once connected). Between attempts a command fails at once;
 * an attempt takes at most `CONNECT_TIMEOUT_MS` and a command waits at most `COMMAND_TIMEOUT_MS`.
 *
 * Every failure but Redis refusing the command itself is a `RedisError` with `ERR_REDIS_CONNECTION_CLOSED`, the code
 * the cache's `DegradingCacheStore` treats as "answer a miss".
 */
export class AppRedis implements CacheRedis, OnShutdown {
  readonly #client: Bun.RedisClient;
  #retryAt = 0;
  #wait = RECONNECT_FIRST_MS;
  #connecting: Promise<void> | undefined;

  constructor(config: AppConfigService) {
    const { url } = config.get('redis');
    // No url: Bun's own chain ($VALKEY_URL, $REDIS_URL, then localhost).
    const options = { connectionTimeout: CONNECT_TIMEOUT_MS, maxRetries: 0 };
    this.#client =
      url === undefined
        ? new Bun.RedisClient(undefined, options)
        : new Bun.RedisClient(url, options);
  }

  get connected(): boolean {
    return this.#client.connected;
  }

  ping(): Promise<string> {
    return this.#run('PING', () => this.#client.ping());
  }

  get(key: string): Promise<string | null> {
    return this.#run('GET', () => this.#client.get(key));
  }

  /** `SET key value`, with `EX seconds` or `PX milliseconds`. */
  set(
    key: string,
    value: string,
    options: { readonly ex?: number; readonly px?: number } = {},
  ): Promise<string | null> {
    return this.#run('SET', () =>
      options.ex !== undefined
        ? this.#client.set(key, value, 'EX', options.ex)
        : options.px !== undefined
          ? this.#client.set(key, value, 'PX', options.px)
          : this.#client.set(key, value),
    );
  }

  del(key: string): Promise<number> {
    return this.#run('DEL', () => this.#client.del(key));
  }

  mget(...keys: string[]): Promise<(string | null)[]> {
    return this.#run('MGET', () => this.#client.mget(...keys));
  }

  ttl(key: string): Promise<number> {
    return this.#run('TTL', () => this.#client.ttl(key));
  }

  /** Any other command (`EVAL`, say). */
  send(command: string, args: readonly (string | number)[]): Promise<unknown> {
    return this.#run(command, () =>
      this.#client.send(
        command,
        args.map((arg) => String(arg)),
      ),
    );
  }

  onShutdown(): void {
    this.#client.close();
  }

  async #run<T>(command: string, call: () => Promise<T>): Promise<T> {
    try {
      await within(this.#ready(), CONNECT_TIMEOUT_MS * 2, () => {
        throw new Error(`not connected in ${CONNECT_TIMEOUT_MS * 2} ms`);
      });
      // Bun raises some errors synchronously: inside the try either way.
      return await within(call(), COMMAND_TIMEOUT_MS, () => {
        throw new Error(`no answer in ${COMMAND_TIMEOUT_MS} ms`);
      });
    } catch (cause) {
      throw new RedisError(
        isServerError(cause)
          ? RedisErrorCode.SERVER_ERROR
          : RedisErrorCode.CONNECTION_CLOSED,
        cause instanceof Error ? cause.message : String(cause),
        command,
        cause,
      );
    }
  }

  /** Connected, or connecting now when the wait since the last failed attempt is over; otherwise a failure at once. */
  async #ready(): Promise<void> {
    if (this.#client.connected) return;
    if (this.#connecting === undefined) {
      const now = Date.now();
      if (now < this.#retryAt) throw new Error('redis is down');
      this.#connecting = this.#client
        .connect()
        .then(
          () => {
            this.#wait = RECONNECT_FIRST_MS;
          },
          (error: unknown) => {
            this.#retryAt = Date.now() + this.#wait;
            this.#wait = Math.min(this.#wait * 2, RECONNECT_MAX_MS);
            throw error;
          },
        )
        .finally(() => {
          this.#connecting = undefined;
        });
    }
    await this.#connecting;
  }
}

/** The module that owns the connection: one instance however many modules import it (a static module, not a dynamic one). */
@Module({ providers: [AppRedis], exports: [AppRedis] })
export class AppRedisModule {}
