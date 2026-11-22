import { Module } from '@dunx/core';
import {
  CacheMetrics,
  CacheModule as CacheLayer,
  MemoryCacheStore,
  TieredCacheStore,
} from '@dunx/infra/cache';
import { RedisConnection, RedisMetrics } from '@dunx/infra/redis';
import { appRedis } from './app-redis.js';
import { CacheL2, CacheL2Module } from './cache-l2.js';

/**
 * The Redis connection (the rate limit's counter) and a two-tier `Cache` in front of
 * it, for the boards and hero pages of step 4. No routes of its own.
 */
@Module({
  imports: [
    appRedis,
    // In this scope too: exporting `CacheL2` needs it visible from here.
    CacheL2Module,
    /**
     * Two tiers, always. `CacheL2` is the degrading half, so a cold read costs
     * the loader rather than a 500 when Redis is down.
     */
    CacheLayer.forRootAsync(
      {
        imports: [CacheL2Module],
        useFactory: (l2: CacheL2) => ({
          ttl: 30_000,
          // One prefix per deployment, not per process, so every replica and
          // restart reads the same L2.
          prefix: `${process.env['DUNX_CACHE_PREFIX'] ?? 'gravoth'}:cache`,
          store: new TieredCacheStore(
            new MemoryCacheStore({ max: 500 }),
            l2.store,
            { ttl: 5_000 },
          ),
        }),
        inject: [CacheL2] as const,
      },
      { metrics: true },
    ),
  ],
  exports: [CacheL2, CacheMetrics, RedisConnection, RedisMetrics],
})
export class CacheModule {}
