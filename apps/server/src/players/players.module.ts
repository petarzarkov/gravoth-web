import { Module } from '@dunx/core';
import { DatabaseModule } from '../database/database.module.js';
import { GuestUpgrade } from './guest-upgrade.js';
import { Profiles } from './profiles.service.js';

/**
 * The player's data that better-auth's own hooks call into (a profile at sign-up, the guest's heroes at an upgrade),
 * with no routes: the routes need the session guard, which lives in the accounts module that imports this one.
 */
@Module({
  imports: [DatabaseModule],
  providers: [Profiles, GuestUpgrade],
  exports: [Profiles, GuestUpgrade],
})
export class PlayersModule {}
