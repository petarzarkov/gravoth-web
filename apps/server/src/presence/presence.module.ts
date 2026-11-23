import { Module, provide } from '@dunx/core';
import { CacheModule } from '../cache/cache.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { Presence, PresenceStore, RedisPresenceStore } from './presence.js';

/**
 * Friends' online status (presence.ts): the marks in Redis and who shows as online. No routes; `MarkPresence` runs in
 * the features' own scopes after `SessionGuard`, and the friends list and the conversations read `Presence`.
 */
@Module({
  imports: [CacheModule, DatabaseModule],
  providers: [
    provide(PresenceStore, { useClass: RedisPresenceStore }),
    Presence,
  ],
  exports: [Presence, PresenceStore],
})
export class PresenceModule {}
