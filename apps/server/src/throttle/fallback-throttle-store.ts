import type { Logger } from '@dunx/core';
import { ThrottleStore } from '@dunx/http';
import type { AppRedis } from '../cache/app-redis.js';

/** `INCR`, and the window's `EXPIRE` on its first count, as one step: a connection lost between the two never leaves a counter that never expires. */
const HIT =
  "local used = redis.call('INCR', KEYS[1]) if used == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return used";

/** The count in Redis, one script per hit (dunx's `RedisThrottleStore` sends `INCR` and `EXPIRE` apart). */
export class RedisCounterStore extends ThrottleStore {
  constructor(private readonly redis: AppRedis) {
    super();
  }

  async hit(key: string, windowSeconds: number): Promise<number> {
    return Number(await this.redis.send('EVAL', [HIT, 1, key, windowSeconds]));
  }

  async ttl(key: string): Promise<number | undefined> {
    const left = await this.redis.ttl(key);
    return left > 0 ? left : undefined;
  }
}

/**
 * The rate limit's counter: Redis (shared by every replica) whenever it answers, and this process's memory for each
 * count it does not, so a Redis that is down never lifts the limit and a Redis that comes back counts again at once.
 * Decided per call rather than once at boot: the app boots without Redis and starts counting there when it appears.
 * One line when it falls back, one when Redis counts again.
 */
export class FallbackThrottleStore extends ThrottleStore {
  #down = false;

  constructor(
    private readonly redis: ThrottleStore,
    private readonly memory: ThrottleStore,
    private readonly logger: Logger,
  ) {
    super();
  }

  async hit(key: string, windowSeconds: number): Promise<number | undefined> {
    try {
      const used = await this.redis.hit(key, windowSeconds);
      this.#up();
      return used;
    } catch (error) {
      this.#fellBack(error);
      return this.memory.hit(key, windowSeconds);
    }
  }

  async ttl(key: string): Promise<number | undefined> {
    try {
      return (await this.redis.ttl(key)) ?? (await this.memory.ttl(key));
    } catch (error) {
      this.#fellBack(error);
      return this.memory.ttl(key);
    }
  }

  #fellBack(error: unknown): void {
    if (this.#down) return;
    this.#down = true;
    this.logger.warn(
      'rate limit counting in memory: redis is unreachable, so the budget is per process until it is back',
      { reason: error instanceof Error ? error.message : String(error) },
    );
  }

  #up(): void {
    if (!this.#down) return;
    this.#down = false;
    this.logger.info('rate limit counting in redis again');
  }
}
