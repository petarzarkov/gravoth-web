import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageOptions, type Storage } from '@dunx/infra/files';
import { RecordingLogger } from '@dunx/testing';
import { BackupTarget } from './backup/backup-target.js';
import { backupKey, backupTime, DatabaseBackup } from './backup/database-backup.js';
import { PgDump, type DumpJob } from './backup/pg-dump.js';
import { AppConfigService, validate } from './config.js';

/**
 * The nightly backup with a local folder standing in for the R2 bucket (the same `@dunx/infra/files` contract) and a
 * stand-in for `pg_dump`, which the image has and a development machine need not. The real binary against the real
 * database is checked by building the image (docs/online-plan.md, "Backups").
 */
class FolderTarget extends BackupTarget {
  override readonly storage: Storage;
  override readonly description = 'folder';
  constructor(config: AppConfigService, root: string) {
    super(config);
    this.storage = new LocalStorageOptions(root).create();
  }
}

class FakeDump extends PgDump {
  constructor(
    config: AppConfigService,
    private readonly bytes: Uint8Array,
    private readonly code = 0,
  ) {
    super(config);
  }
  override start(): DumpJob {
    const { bytes, code } = this;
    return {
      stdout: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      exited: Promise.resolve(code),
      stderr: Promise.resolve(code === 0 ? '' : 'pg_dump: error: connection to server failed'),
      kill: () => undefined,
    };
  }
}

let root = '';
const config = new AppConfigService(validate({ BACKUP_KEEP_DAYS: '30' }));
const dumpBytes = new TextEncoder().encode('PGDMP custom-format dump');

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'gravoth-backup-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const keys = async (storage: Storage): Promise<string[]> => {
  const found: string[] = [];
  for await (const entry of storage.list({ prefix: 'postgres/' })) found.push(entry.key);
  return found.sort();
};

describe('the nightly database backup', () => {
  it('is skipped with a log line while R2 is not configured', async () => {
    const logger = new RecordingLogger();
    const backup = new DatabaseBackup(new BackupTarget(config), new FakeDump(config, dumpBytes), config, logger);

    expect(await backup.run()).toEqual({ status: 'skipped' });
    expect(JSON.stringify(logger.entries)).toContain('database backup skipped: R2 is not configured');
  });

  it('names each backup by the moment it was taken, and reads the moment back', () => {
    const at = new Date('2026-11-22T03:30:00.000Z');

    expect(backupKey(at)).toBe('postgres/gravoth-2026-11-22T03-30-00Z.dump');
    expect(backupTime(backupKey(at))?.toISOString()).toBe(at.toISOString());
    expect(backupTime('postgres/somebody-elses-file.sql')).toBeUndefined();
  });

  it('streams the dump into the bucket and deletes its own backups past BACKUP_KEEP_DAYS', async () => {
    const target = new FolderTarget(config, root);
    const now = new Date('2026-11-22T03:30:00.000Z');
    const old = backupKey(new Date('2026-10-01T03:30:00.000Z'));
    const recent = backupKey(new Date('2026-11-01T03:30:00.000Z'));
    await target.storage.write(old, 'old');
    await target.storage.write(recent, 'recent');
    await target.storage.write('postgres/notes.txt', 'not a backup');

    const backup = new DatabaseBackup(target, new FakeDump(config, dumpBytes), config, new RecordingLogger());
    const result = await backup.run(now);

    expect(result).toEqual({ status: 'done', key: backupKey(now), bytes: dumpBytes.length, pruned: [old] });
    expect(await target.storage.read(backupKey(now))).toBe('PGDMP custom-format dump');
    expect(await keys(target.storage)).toEqual([backupKey(now), recent, 'postgres/notes.txt'].sort());
  });

  it('leaves nothing behind when pg_dump fails, and says why', async () => {
    const target = new FolderTarget(config, root);
    const now = new Date('2026-11-23T03:30:00.000Z');
    const backup = new DatabaseBackup(target, new FakeDump(config, dumpBytes, 1), config, new RecordingLogger());

    const result = await backup.run(now);

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' ? result.reason : '').toContain('pg_dump exited 1');
    expect(await target.storage.exists(backupKey(now))).toBe(false);
  });

  it('hands pg_dump the connection by environment, never on its command line', () => {
    const source = PgDump.prototype.start.toString();

    expect(source).toContain('PGPASSWORD');
    expect(source).not.toContain('--dbname');
  });
});
