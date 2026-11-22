import { Logger, Module } from '@dunx/core';
import {
  ClientAddress,
  MemoryThrottleStore,
  RedisThrottleStore,
  ThrottleModule,
} from '@dunx/http';
import { RedisConnection } from '@dunx/infra/redis';
import { CacheModule } from '../cache/cache.module.js';
import { AppConfigService } from '../config.js';

/**
 * A fixed-window rate limit over the whole app (`THROTTLE_LIMIT` per
 * `THROTTLE_WINDOW_SECONDS` per caller), counting in Redis when it answers at boot
 * and in memory otherwise. The guard fails open, so with `RedisThrottleStore` and no
 * Redis nothing would be counted: hence the probe.
 */
@Module({
  imports: [
    CacheModule,
    ThrottleModule.forRootAsync({
      imports: [CacheModule],
      useFactory: async (
        config: AppConfigService,
        redis: RedisConnection,
        address: ClientAddress,
        logger: Logger,
      ) => {
        // Bun raises some connection errors synchronously, so a try around the
        // call rather than a `.catch` on the promise.
        let reachable = true;
        try {
          await redis.ping();
        } catch {
          reachable = false;
        }
        logger.info(
          reachable
            ? 'rate limit counting in redis, shared by every replica'
            : 'rate limit counting in memory: redis is unreachable, so the budget is per process',
        );
        return {
          ...config.get('throttle'),
          prefix: config.get('appName'),
          store: reachable
            ? new RedisThrottleStore(redis)
            : new MemoryThrottleStore(),
          // Who is counted: the caller's address (Cloudflare's, read through the
          // trusted proxy headers in production).
          subject: (req: Bun.BunRequest) => address.of(req),
        };
      },
      inject: [
        AppConfigService,
        RedisConnection,
        ClientAddress,
        Logger,
      ] as const,
    }),
  ],
})
export class LimitsModule {}
