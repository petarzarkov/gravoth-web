/**
 * `bun run backup:now` (in the image: `docker exec gravoth-api bun scripts/backup-now.ts`): one backup now, the same
 * job the 03:30 schedule runs, so the restore drill need not wait for the night. Boots the app without serving it,
 * runs the job, prints its result (the key and size; never a credential) and exits non-zero unless it is done.
 */
import { DatabaseBackup } from '../src/backup/database-backup.js';
import { createApp } from '../src/main.js';

const app = await createApp();
let ok = false;
try {
  const result = await app.get(DatabaseBackup).run();
  console.log(JSON.stringify(result));
  ok = result.status === 'done';
} finally {
  await app.shutdown();
}
process.exit(ok ? 0 : 1);
