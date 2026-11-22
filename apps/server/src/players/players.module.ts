import { Module } from '@dunx/core';
import { DatabaseModule } from '../database/database.module.js';
import { GuestCleanup } from './guest-cleanup.js';
import { GuestUpgrade } from './guest-upgrade.js';
import { Profiles } from './profiles.service.js';

/**
 * The player's data that better-auth's own hooks call into (a profile at sign-up, the guest's heroes at an upgrade),
 * with no routes: the routes need the session guard, which lives in the accounts module that imports this one. And the
 * daily clean-up of the guests nobody uses (its `@Cron` armed by the schedule module).
 */
@Module({
  imports: [DatabaseModule],
  providers: [Profiles, GuestUpgrade, GuestCleanup],
  exports: [Profiles, GuestUpgrade],
})
export class PlayersModule {}
