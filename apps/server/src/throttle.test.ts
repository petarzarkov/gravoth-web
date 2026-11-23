import { describe, expect, it } from 'bun:test';
import type { Logger } from '@dunx/core';
import { MemoryThrottleStore, ThrottleStore } from '@dunx/http';
import type { AppRedis } from './cache/app-redis.js';
import {
  FallbackThrottleStore,
  RedisCounterStore,
} from './throttle/fallback-throttle-store.js';

/**
 * The rate limit's counter (throttle.module.ts): Redis whenever it answers, this process's memory for each count it
 * does not, and Redis again once it is back, with no restart. Redis itself going away and coming back is
 * e2e/redis.e2e.ts's, over the real stack.
 */
class SwitchableRedis extends ThrottleStore {
  up = true;
  readonly counts = new Map<string, number>();

  async hit(key: string): Promise<number> {
    if (!this.up) throw new Error('INCR: Connection has failed');
    const used = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, used);
    return used;
  }

  async ttl(): Promise<number | undefined> {
    if (!this.up) throw new Error('TTL: Connection has failed');
    return 42;
  }
}

const recorder = () => {
  const lines: string[] = [];
  const logger = {
    warn: (message: string) => lines.push(`warn ${message}`),
    info: (message: string) => lines.push(`info ${message}`),
  } as unknown as Logger;
  return { lines, logger };
};

describe('the rate limit counter', () => {
  it('counts in Redis, in memory while Redis is down, and in Redis again once it is back', async () => {
    const redis = new SwitchableRedis();
    const { lines, logger } = recorder();
    const store = new FallbackThrottleStore(
      redis,
      new MemoryThrottleStore(),
      logger,
    );
    expect(await store.hit('k', 60)).toBe(1);
    expect(await store.hit('k', 60)).toBe(2);
    expect(await store.ttl('k')).toBe(42);

    // Down: never undefined (the guard would let everything through), counted in memory instead.
    redis.up = false;
    expect(await store.hit('k', 60)).toBe(1);
    expect(await store.hit('k', 60)).toBe(2);
    expect(await store.hit('k', 60)).toBe(3);
    expect(await store.ttl('k')).toBeGreaterThan(0);

    // Back: Redis counts again where it left off.
    redis.up = true;
    expect(await store.hit('k', 60)).toBe(3);
    expect(redis.counts.get('k')).toBe(3);
    expect(lines).toEqual([
      'warn rate limit counting in memory: redis is unreachable, so the budget is per process until it is back',
      'info rate limit counting in redis again',
    ]);
  });

  it('counts in Redis with one script per hit: INCR, and the EXPIRE on the first', async () => {
    const sent: unknown[][] = [];
    const redis = {
      send: async (...args: unknown[]) => {
        sent.push(args);
        return 7;
      },
      ttl: async (key: string) => (key === 'gone' ? -2 : 30),
    } as unknown as AppRedis;
    const store = new RedisCounterStore(redis);
    expect(await store.hit('gravoth:throttle:x', 600)).toBe(7);
    expect(sent).toHaveLength(1);
    const [command, args] = sent[0] as [string, unknown[]];
    expect(command).toBe('EVAL');
    expect(args.slice(1)).toEqual([1, 'gravoth:throttle:x', 600]);
    expect(String(args[0])).toContain("redis.call('EXPIRE', KEYS[1], ARGV[1])");
    expect(await store.ttl('k')).toBe(30);
    expect(await store.ttl('gone')).toBeUndefined();
  });
});
