import { Module } from '@dunx/core';
import { BackupTarget } from './backup-target.js';
import { DatabaseBackup } from './database-backup.js';
import { PgDump } from './pg-dump.js';

/** The nightly Postgres backup to Cloudflare R2; its `@Cron` is armed by the schedule module. */
@Module({
  providers: [BackupTarget, PgDump, DatabaseBackup],
  exports: [DatabaseBackup],
})
export class BackupModule {}
