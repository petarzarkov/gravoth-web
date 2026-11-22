import { Module, provide } from '@dunx/core';
import { AccountsModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { GravothModule } from '../gravoth/gravoth.module.js';
import { HeroesModule } from '../heroes/heroes.module.js';
import { BoardsController } from './boards.controller.js';
import { Boards } from './boards.service.js';
import { BuildCheck, ValidatorBuildCheck } from './build-check.js';
import { BoardCatalog } from './catalog.js';

/** Leaderboards whose every row opens the build that set it (docs/online-plan.md, step 4). */
@Module({
  imports: [AccountsModule, DatabaseModule, GravothModule, HeroesModule],
  controllers: [BoardsController],
  providers: [BoardCatalog, Boards, provide(BuildCheck, { useClass: ValidatorBuildCheck })],
})
export class BoardsModule {}
