import { Logger, Module } from '@dunx/core';
import { ClientAddress, MemoryThrottleStore, ThrottleModule } from '@dunx/http';
import { AppRedis } from '../cache/app-redis.js';
import { CacheModule } from '../cache/cache.module.js';
import { AppConfigService } from '../config.js';
import {
  FallbackThrottleStore,
  RedisCounterStore,
} from './fallback-throttle-store.js';

/**
 * A fixed-window rate limit over the whole app (`THROTTLE_LIMIT` per
 * `THROTTLE_WINDOW_SECONDS` per caller), counted in Redis whenever it answers and
 * in this process's memory for each count it does not (`FallbackThrottleStore`):
 * the guard fails open on a store that throws, so a Redis store alone would stop
 * counting while Redis is down. The shared connection reconnects itself
 * (cache/app-redis.ts), so counting goes back to Redis when it is back, with no
 * restart, and the app boots without it.
 */
@Module({
  imports: [
    CacheModule,
    ThrottleModule.forRootAsync({
      imports: [CacheModule],
      useFactory: async (
        config: AppConfigService,
        redis: AppRedis,
        address: ClientAddress,
        logger: Logger,
      ) => {
        // The first command connects (or finds Redis down, and the app boots
        // anyway). AppRedis turns every failure into a rejection.
        let reachable = true;
        try {
          await redis.ping();
        } catch {
          reachable = false;
        }
        logger.info(
          reachable
            ? 'rate limit counting in redis, shared by every replica'
            : 'rate limit counting in memory until redis answers: it is unreachable, so the budget is per process',
        );
        return {
          ...config.get('throttle'),
          prefix: config.get('appName'),
          store: new FallbackThrottleStore(
            new RedisCounterStore(redis),
            new MemoryThrottleStore(),
            logger,
          ),
          // Who is counted: the caller's address (Cloudflare's, read through the
          // trusted proxy headers in production).
          subject: (req: Bun.BunRequest) => address.of(req),
        };
      },
      inject: [AppConfigService, AppRedis, ClientAddress, Logger] as const,
    }),
  ],
})
export class LimitsModule {}
