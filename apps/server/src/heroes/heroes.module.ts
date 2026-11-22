import { Module } from '@dunx/core';
import { AccountsModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { GravothModule } from '../gravoth/gravoth.module.js';
import { Builds } from './builds.service.js';
import { HeroBuilds } from './hero-builds.service.js';
import {
  BuildsController,
  HeroesController,
  PlayersController,
} from './heroes.controller.js';
import { Heroes } from './heroes.service.js';
import { PlayerPages } from './player-pages.service.js';

/**
 * Heroes and their immutable build snapshots (step 4's build cards), every hero's build and the player pages
 * (decision 226); the online realm's heroes (decision 227) are written by the realm module through these.
 */
@Module({
  imports: [AccountsModule, DatabaseModule, GravothModule],
  controllers: [HeroesController, BuildsController, PlayersController],
  providers: [Heroes, Builds, HeroBuilds, PlayerPages],
  exports: [Heroes, Builds],
})
export class HeroesModule {}
