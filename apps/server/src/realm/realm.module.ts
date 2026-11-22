import { Module } from '@dunx/core';
import { AccountsModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { GravothModule } from '../gravoth/gravoth.module.js';
import { HeroesModule } from '../heroes/heroes.module.js';
import { RealmSync } from './realm-sync.js';
import { RealmController } from './realm.controller.js';
import { Realms } from './realms.service.js';

/** The online realm (decision 227): the lease, the uploads, and the rules checker's read of each landed on heroes and boards. */
@Module({
  imports: [AccountsModule, DatabaseModule, GravothModule, HeroesModule],
  controllers: [RealmController],
  providers: [Realms, RealmSync],
  exports: [RealmSync],
})
export class RealmModule {}
