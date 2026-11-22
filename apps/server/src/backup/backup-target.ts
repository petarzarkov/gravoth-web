import { S3StorageOptions, type Storage } from '@dunx/infra/files';
import { AppConfigService } from '../config.js';

/**
 * Where the nightly backups go: the Cloudflare R2 bucket in R2_BUCKET, through `@dunx/infra/files`' `S3Storage` over
 * `Bun.S3Client` (R2 speaks S3 at `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`, region `auto`). Undefined while
 * the four R2 variables are unset, which turns the backup into a log line.
 *
 * A class so a test can point it at a local folder instead.
 */
export class BackupTarget {
  readonly storage: Storage | undefined;
  /** Where the log lines say the backups went, with no credential in it. */
  readonly description: string | undefined;

  constructor(config: AppConfigService) {
    const r2 = config.get('backup').r2;
    this.storage =
      r2 === undefined
        ? undefined
        : new S3StorageOptions({
            bucket: r2.bucket,
            accessKeyId: r2.accessKeyId,
            secretAccessKey: r2.secretAccessKey,
            endpoint:
              r2.endpoint ?? `https://${r2.accountId}.r2.cloudflarestorage.com`,
            // R2 signs for `auto`; any other S3 (MinIO) for the usual default.
            region: r2.endpoint === undefined ? 'auto' : 'us-east-1',
          }).create();
    this.description =
      r2 === undefined
        ? undefined
        : r2.endpoint === undefined
          ? `r2://${r2.bucket}`
          : `s3://${r2.bucket} at ${new URL(r2.endpoint).host}`;
  }
}
