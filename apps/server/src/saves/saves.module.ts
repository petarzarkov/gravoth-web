import { Module } from '@dunx/core';
import { AccountsModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { CloudSaves } from './cloud-saves.service.js';
import { SavesController } from './saves.controller.js';

/** The game's cloud save, one copy per account (decision 225). */
@Module({
  imports: [AccountsModule, DatabaseModule],
  controllers: [SavesController],
  providers: [CloudSaves],
})
export class SavesModule {}
