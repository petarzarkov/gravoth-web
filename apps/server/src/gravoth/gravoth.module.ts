import { Module } from '@dunx/core';
import { DatabaseModule } from '../database/database.module.js';
import { MetaController } from './meta.controller.js';
import { GravothMeta } from './meta.service.js';
import { ValidatorClient } from './validator.client.js';

/** The game's own routes (decision 171): health and meta, and the client for the rules checker the boards use. */
@Module({
  imports: [DatabaseModule],
  controllers: [MetaController],
  providers: [GravothMeta, ValidatorClient],
  exports: [ValidatorClient],
})
export class GravothModule {}
