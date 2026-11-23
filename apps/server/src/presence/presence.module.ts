import { Module, provide } from '@dunx/core';
import { DatabaseModule } from '../database/database.module.js';
import { PresenceRedis } from './presence-redis.js';
import { Presence, PresenceStore, RedisPresenceStore } from './presence.js';

/**
 * Friends' online status (presence.ts): the marks in Redis (over its own connection, presence-redis.ts) and who shows
 * as online. No routes; `MarkPresence` runs in the features' own scopes after `SessionGuard`, and the friends list and
 * the conversations read `Presence`.
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    PresenceRedis,
    provide(PresenceStore, { useClass: RedisPresenceStore }),
    Presence,
  ],
  exports: [Presence, PresenceStore],
})
export class PresenceModule {}
