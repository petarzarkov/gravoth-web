import { Module } from '@dunx/core';
import { AccountsModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { Builds } from './builds.service.js';
import { BuildsController, HeroesController } from './heroes.controller.js';
import { Heroes } from './heroes.service.js';

/** Heroes and their immutable build snapshots (step 4's build cards; step 5's online heroes join here). */
@Module({
  imports: [AccountsModule, DatabaseModule],
  controllers: [HeroesController, BuildsController],
  providers: [Heroes, Builds],
  exports: [Heroes, Builds],
})
export class HeroesModule {}
