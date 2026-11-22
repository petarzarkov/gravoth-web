import { Logger } from '@dunx/core';
import { Cron } from '@dunx/infra/schedule';
import { AppConfigService } from '../config.js';
import { BackupTarget } from './backup-target.js';
import { PgDump } from './pg-dump.js';

/** Every backup's key: `postgres/gravoth-2026-11-22T03-30-00Z.dump`. */
export const BACKUP_PREFIX = 'postgres/';
const KEY = /^postgres\/gravoth-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.dump$/;

export const backupKey = (at: Date): string => `${BACKUP_PREFIX}gravoth-${at.toISOString().slice(0, 19).replaceAll(':', '-')}Z.dump`;

/** When a backup was taken, read back from its key; undefined for a key this job did not write. */
export const backupTime = (key: string): Date | undefined => {
  const match = KEY.exec(key);
  return match === null ? undefined : new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
};

export type BackupResult =
  | { readonly status: 'skipped' }
  | { readonly status: 'done'; readonly key: string; readonly bytes: number; readonly pruned: readonly string[] }
  | { readonly status: 'failed'; readonly key: string; readonly reason: string };

/**
 * The nightly logical backup (docs/online-plan.md, "Backups"): at 03:30 (SCHEDULE_TZ, UTC by default) `pg_dump`'s
 * output streams straight into the R2 bucket (multipart, never whole in memory), and backups older than
 * BACKUP_KEEP_DAYS are deleted. A dump that fails leaves no object behind, so every object in the bucket is a whole
 * dump. Without the R2 variables it logs that it skipped and does nothing.
 *
 * One process runs it (one node on the Pi). The restore is `pg_restore --clean --if-exists --no-owner -d gravoth
 * <file>`, drilled before launch.
 */
export class DatabaseBackup {
  constructor(
    private readonly target: BackupTarget,
    private readonly dump: PgDump,
    private readonly config: AppConfigService,
    private readonly logger: Logger,
  ) {}

  @Cron('30 3 * * *', { name: 'database-backup' })
  async nightly(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      this.logger.error('database backup failed', { err: error });
    }
  }

  async run(now = new Date()): Promise<BackupResult> {
    const storage = this.target.storage;
    if (storage === undefined) {
      this.logger.info('database backup skipped: R2 is not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)');
      return { status: 'skipped' };
    }
    const key = backupKey(now);
    const job = this.dump.start();
    let bytes = 0;
    let reason: string | undefined;
    try {
      bytes = await storage.write(key, job.stdout);
    } catch (error) {
      job.kill();
      reason = `upload failed: ${(error as Error).message}`;
    }
    const code = await job.exited;
    if (reason === undefined && code !== 0) reason = `pg_dump exited ${code}: ${(await job.stderr).trim().slice(0, 500)}`;
    if (reason !== undefined) {
      await storage.delete(key).catch(() => undefined);
      this.logger.error('database backup failed', { key, reason });
      return { status: 'failed', key, reason };
    }
    const pruned = await this.prune(now);
    this.logger.info('database backed up', { to: this.target.description, key, bytes, pruned: pruned.length });
    return { status: 'done', key, bytes, pruned };
  }

  /** Deletes this job's backups older than BACKUP_KEEP_DAYS; anything else in the bucket is left alone. */
  private async prune(now: Date): Promise<string[]> {
    const storage = this.target.storage;
    if (storage === undefined) return [];
    const cutoff = now.getTime() - this.config.get('backup').keepDays * 86_400_000;
    const old: string[] = [];
    for await (const entry of storage.list({ prefix: BACKUP_PREFIX })) {
      const taken = backupTime(entry.key);
      if (taken !== undefined && taken.getTime() < cutoff) old.push(entry.key);
    }
    for (const key of old) await storage.delete(key);
    return old;
  }
}
