import { describe, expect, it } from 'bun:test';
import { isConnectionError } from '@dunx/infra/redis';
import { AppRedis } from './cache/app-redis.js';
import type { AppConfigService } from './config.js';

/**
 * The app's Redis connection (cache/app-redis.ts) with no Redis to reach: every command fails at once as a connection
 * error (what the cache answers a miss for and the rate limit counts in memory for), and between connection attempts
 * no attempt is made. Reconnecting to a Redis that comes back is e2e/redis.e2e.ts's, over the real stack.
 */
const unreachable = () =>
  new AppRedis({
    get: () => ({ url: 'redis://127.0.0.1:1' }),
  } as unknown as AppConfigService);

const failure = async (work: Promise<unknown>) => {
  const started = performance.now();
  try {
    await work;
  } catch (error) {
    return { error, ms: performance.now() - started };
  }
  throw new Error('the command answered');
};

describe('the Redis connection with Redis down', () => {
  it('fails every command at once as a connection error, and waits before connecting again', async () => {
    const redis = unreachable();
    const first = await failure(redis.ping());
    expect(isConnectionError(first.error)).toBe(true);
    expect(first.ms).toBeLessThan(1_500);
    expect(redis.connected).toBe(false);
    // Within the wait after a failed attempt: no attempt, an answer at once.
    for (const work of [
      redis.get('k'),
      redis.set('k', 'v', { ex: 10 }),
      redis.mget('a', 'b'),
      redis.send('EVAL', ['return 1', 0]),
    ]) {
      const next = await failure(work);
      expect(isConnectionError(next.error)).toBe(true);
      expect(String((next.error as Error).message)).toContain('redis is down');
      expect(next.ms).toBeLessThan(50);
    }
    redis.onShutdown();
  });

  it('tries to connect again once the wait is over', async () => {
    const redis = unreachable();
    await failure(redis.ping());
    await Bun.sleep(300);
    const again = await failure(redis.ping());
    expect(isConnectionError(again.error)).toBe(true);
    expect(String((again.error as Error).message)).not.toContain(
      'redis is down',
    );
    redis.onShutdown();
  });
});
