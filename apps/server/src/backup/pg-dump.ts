import { AppConfigService } from '../config.js';

/** One running dump: its bytes as they come, and how it ended. */
export interface DumpJob {
  readonly stdout: ReadableStream<Uint8Array>;
  /** The exit code. */
  readonly exited: Promise<number>;
  /** What it wrote on stderr (pg_dump's error lines never hold the password, which goes by environment). */
  readonly stderr: Promise<string>;
  kill(): void;
}

/**
 * `pg_dump` against the app's database: the custom format (compressed, and `pg_restore` can restore it whole or one
 * table at a time), with no owners or grants so it restores into any role. The image carries Debian's Postgres 17
 * client, the server's own major version (Dockerfile). The connection goes by the `PG*` environment variables, so the
 * password is never on a command line.
 *
 * A class so a test can stand in for the binary, which the development machine need not have.
 */
export class PgDump {
  constructor(private readonly config: AppConfigService) {}

  start(): DumpJob {
    const url = new URL(this.config.get('database').url);
    const child = Bun.spawn(['pg_dump', '--format=custom', '--compress=6', '--no-owner', '--no-privileges'], {
      env: {
        PATH: Bun.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
        PGHOST: url.hostname,
        PGPORT: url.port === '' ? '5432' : url.port,
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
        PGCONNECT_TIMEOUT: '10',
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return {
      stdout: child.stdout,
      exited: child.exited,
      stderr: new Response(child.stderr).text(),
      kill: () => child.kill(),
    };
  }
}
