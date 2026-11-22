import {
  ConfigModule,
  ConfigService,
  type ConfigSource,
  type DynamicModule,
  LogLevel,
} from '@dunx/core';
import { resolve } from 'node:path';
import { z } from 'zod';

/** What `AUTH_SECRET` is when nothing sets it. Public, so never good enough for production. */
const DEVELOPMENT_SECRET = 'dunx-development-secret-not-for-production';

/** compose.yml's password for the local database on 127.0.0.1. Public, so production refuses it like the secret. */
const LOCAL_DATABASE_PASSWORD = 'gravoth-local';

/** Where the API is reached in production (the Cloudflare Tunnel's public hostname). */
export const DEFAULT_PUBLIC_URL = 'https://gravoth-api.petarzarkov.com';

/**
 * One validation function, which is the whole `ConfigModule` contract. dunx does
 * not pick the library - this is zod because the routes already use it, and a
 * hand-written function that throws would work identically.
 *
 * `.default()` is where a value comes from when the variable is unset, so a clean
 * checkout boots with no `.env` at all. Bun loads `.env` and `.env.local` itself,
 * so there is nothing here that reads a file.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  HOST: z.string().min(1).optional(),
  /**
   * The origin the API is reached on: mail links and the OAuth redirect URIs (`<PUBLIC_URL>/api/auth/callback/<provider>`)
   * are built from it. Absent: https://gravoth-api.petarzarkov.com in production, localhost otherwise.
   */
  PUBLIC_URL: z.url().optional(),
  LOG_LEVEL: z.enum(LogLevel).default(LogLevel.INFO),
  /** Unset means console only. Set it to also append JSON to a rotating file. */
  LOG_FILE: z.string().optional(),
  /** Both cost a `req.clone().text()` on the hot path, so off in production. */
  LOG_REQUEST_BODY: z.stringbool().default(false),
  LOG_RESPONSE_BODY: z.stringbool().default(false),
  /**
   * A second origin trusted for credentialed browser calls (better-auth, CORS and the cross-site check): the website's
   * dev server (http://localhost:3001), or a site hosted apart from the API. The API serves its own website, so
   * production needs none.
   */
  CORS_ORIGIN: z.string().default('https://example.com'),
  /**
   * Whether `x-forwarded-for` is believed. Off unless a trusted proxy is in
   * front: with nothing stripping the header, any caller picks its own
   * address, which fakes both rate limiting and the logged client address.
   */
  TRUST_PROXY: z.stringbool().default(false),
  /**
   * The Postgres connection, as one URL. Unset: it is built from the POSTGRES_* parts below (each encoded), which is
   * what compose.prod.yml does, so the password lives only in server/.env as POSTGRES_PASSWORD.
   */
  DATABASE_URL: z.string().min(1).optional(),
  POSTGRES_HOST: z.string().min(1).default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  POSTGRES_USER: z.string().min(1).default('gravoth'),
  /** compose.yml's local default; production refuses to boot on it (or with nothing set). */
  POSTGRES_PASSWORD: z.string().min(1).default(LOCAL_DATABASE_PASSWORD),
  POSTGRES_DB: z.string().min(1).default('gravoth'),
  /** Connections in the pool. The Pi's Postgres allows 100; one app takes a handful. */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  /** Absent is fine: the cache routes report themselves degraded instead of failing. */
  REDIS_URL: z.string().optional(),
  /** `production` in the image. Production refuses to boot on the development secret. */
  NODE_ENV: z.string().default('development'),
  /**
   * better-auth signs sessions and tokens with this; 32 characters is its own minimum.
   * The default is for development and tests only: `validate` refuses it in production.
   */
  AUTH_SECRET: z.string().min(32).default(DEVELOPMENT_SECRET),
  /**
   * How long a session lives without being used; each day of use extends it. Long,
   * because a guest account has no other way back in.
   */
  AUTH_SESSION_DAYS: z.coerce.number().int().min(1).default(90),
  /**
   * Google's **Web application** OAuth client in the game's Google Cloud project: the browser redirect signs in with
   * it, and Android asks Credential Manager for ID tokens with this id as the server client id (the audience the
   * server checks). Both unset: Google is not offered.
   */
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  /** The Discord application's OAuth2 client. Both unset: Discord is not offered. */
  DISCORD_CLIENT_ID: z.string().min(1).optional(),
  DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
  /** Resend's API key, for the domain mail.petarzarkov.com. Unset: mails are logged, never sent. */
  RESEND_API_KEY: z.string().min(1).optional(),
  /** The sender players see. Its domain is the one verified in Resend. */
  MAIL_FROM: z
    .string()
    .min(3)
    .default('Gravoth <no-reply@mail.petarzarkov.com>'),
  /**
   * The nightly backup's Cloudflare R2 bucket and its API token (Object Read & Write on that bucket). All four or
   * none; none skips the backup with a log line.
   */
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET: z.string().min(1).optional(),
  /**
   * Another S3 endpoint for the backups instead of R2's own (`https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`): a
   * local MinIO in an end-to-end run. Production leaves it unset.
   */
  R2_ENDPOINT: z.url().optional(),
  /** Days a nightly backup is kept in the bucket before the job deletes it. */
  BACKUP_KEEP_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  /** The app-wide limit. Generous, so a per-route `@Throttle` is the interesting half. */
  THROTTLE_LIMIT: z.coerce.number().int().min(1).default(1000),
  THROTTLE_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
  /** A `@Cron` that names no zone of its own runs in this one. */
  SCHEDULE_TZ: z.string().default('UTC'),
  /** Gravoth's rules checker (dotnet/Gravoth.Validator in the game's repository), on the private network. */
  VALIDATOR_URL: z.url().default('http://localhost:8080'),
  /** The website's build (`bun run build` in apps/web). Absent: apps/web/dist beside this app. */
  WEB_ROOT: z.string().min(1).optional(),
});

/** apps/web/dist, from apps/server/src. */
const DEFAULT_WEB_ROOT = resolve(import.meta.dir, '../../web/dist');

/** An OAuth client: both halves, or the provider is not offered. */
export interface OAuthClient {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** The R2 bucket the nightly backup goes to. */
export interface R2Bucket {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  /** Set only to send the backups somewhere other than R2 (`R2_ENDPOINT`). */
  readonly endpoint?: string;
}

export interface AppConfig {
  readonly port: number;
  readonly hostname: string | undefined;
  /** No trailing slash. */
  readonly publicUrl: string;
  readonly appName: string;
  readonly log: {
    readonly level: LogLevel;
    readonly file: string | undefined;
    readonly requestBody: boolean;
    readonly responseBody: boolean;
  };
  readonly corsOrigin: string;
  readonly trustProxy: boolean;
  readonly database: { readonly url: string; readonly poolMax: number };
  readonly redis: { readonly url: string | undefined };
  readonly production: boolean;
  readonly auth: { readonly secret: string; readonly sessionDays: number };
  readonly google: OAuthClient | undefined;
  readonly discord: OAuthClient | undefined;
  /** Resend's key (undefined: mails go to the log) and the sender. */
  readonly mail: {
    readonly resendApiKey: string | undefined;
    readonly from: string;
  };
  readonly backup: {
    readonly r2: R2Bucket | undefined;
    readonly keepDays: number;
  };
  readonly authorization: { readonly enabled: boolean };
  readonly throttle: { readonly limit: number; readonly windowSeconds: number };
  readonly schedule: { readonly tz: string };
  readonly validator: { readonly url: string };
  /** The website's build directory, served at `/`. */
  readonly web: { readonly root: string };
}

/**
 * One name for the typed config everywhere. A subclass rather than
 * `ConfigService<AppConfig>` at each site because a factory's `inject: [...]`
 * carries no type argument - the class does, and it is a real runtime value, so it
 * is both a precise token and a usable constructor annotation.
 */
export class AppConfigService extends ConfigService<AppConfig> {}

/** The one broker channel the websocket relay carries every topic on. */
export const RELAY_CHANNEL = '@gravoth/server:ws';

/** Pairs that are set together or not at all. */
const PAIRS = [
  ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'],
] as const;

/** Flat variables in, a shaped object out. Nothing downstream reads `Bun.env`. */
export const validate = (env: ConfigSource): AppConfig => {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n - ');
    throw new Error(`Configuration is invalid:\n - ${issues}`);
  }
  const value = parsed.data;
  const production = value.NODE_ENV === 'production';

  // Never echo a value in these messages: each names the variable and where it lives.
  const problems: string[] = [];
  if (production && value.AUTH_SECRET === DEVELOPMENT_SECRET) {
    problems.push(
      'AUTH_SECRET: unset in production. Put a random string of at least 32 characters ' +
        '(for example the output of `openssl rand -base64 48`) in server/.env as AUTH_SECRET.',
    );
  }
  if (
    production &&
    value.DATABASE_URL === undefined &&
    value.POSTGRES_PASSWORD === LOCAL_DATABASE_PASSWORD
  ) {
    problems.push(
      'POSTGRES_PASSWORD: unset in production. Put a random string (for example the output of `openssl rand -hex 32`) ' +
        'in server/.env as POSTGRES_PASSWORD before the database first starts.',
    );
  }
  for (const [id, secret] of PAIRS) {
    if ((value[id] === undefined) !== (value[secret] === undefined))
      problems.push(`${id} and ${secret} are set together or not at all.`);
  }
  const r2Parts = [
    value.R2_ACCOUNT_ID,
    value.R2_ACCESS_KEY_ID,
    value.R2_SECRET_ACCESS_KEY,
    value.R2_BUCKET,
  ];
  if (
    r2Parts.some((part) => part === undefined) &&
    r2Parts.some((part) => part !== undefined)
  ) {
    problems.push(
      'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are set together or not at all.',
    );
  }
  if (problems.length > 0)
    throw new Error(`Configuration is invalid:\n - ${problems.join('\n - ')}`);

  const client = (
    clientId: string | undefined,
    clientSecret: string | undefined,
  ): OAuthClient | undefined =>
    clientId === undefined || clientSecret === undefined
      ? undefined
      : { clientId, clientSecret };
  const databaseUrl =
    value.DATABASE_URL ??
    `postgres://${encodeURIComponent(value.POSTGRES_USER)}:${encodeURIComponent(value.POSTGRES_PASSWORD)}` +
      `@${value.POSTGRES_HOST}:${value.POSTGRES_PORT}/${encodeURIComponent(value.POSTGRES_DB)}`;
  const r2: R2Bucket | undefined =
    value.R2_ACCOUNT_ID === undefined ||
    value.R2_ACCESS_KEY_ID === undefined ||
    value.R2_SECRET_ACCESS_KEY === undefined ||
    value.R2_BUCKET === undefined
      ? undefined
      : {
          accountId: value.R2_ACCOUNT_ID,
          accessKeyId: value.R2_ACCESS_KEY_ID,
          secretAccessKey: value.R2_SECRET_ACCESS_KEY,
          bucket: value.R2_BUCKET,
          ...(value.R2_ENDPOINT === undefined
            ? {}
            : { endpoint: value.R2_ENDPOINT }),
        };

  return {
    port: value.PORT,
    hostname: value.HOST,
    publicUrl: (
      value.PUBLIC_URL ??
      (production ? DEFAULT_PUBLIC_URL : `http://localhost:${value.PORT}`)
    ).replace(/\/+$/, ''),
    appName: '@gravoth/server',
    log: {
      level: value.LOG_LEVEL,
      file: value.LOG_FILE,
      requestBody: value.LOG_REQUEST_BODY,
      responseBody: value.LOG_RESPONSE_BODY,
    },
    corsOrigin: value.CORS_ORIGIN,
    trustProxy: value.TRUST_PROXY,
    database: { url: databaseUrl, poolMax: value.DATABASE_POOL_MAX },
    redis: { url: value.REDIS_URL },
    production,
    auth: { secret: value.AUTH_SECRET, sessionDays: value.AUTH_SESSION_DAYS },
    google: client(value.GOOGLE_CLIENT_ID, value.GOOGLE_CLIENT_SECRET),
    discord: client(value.DISCORD_CLIENT_ID, value.DISCORD_CLIENT_SECRET),
    mail: { resendApiKey: value.RESEND_API_KEY, from: value.MAIL_FROM },
    backup: { r2, keepDays: value.BACKUP_KEEP_DAYS },
    authorization: { enabled: true },
    throttle: {
      limit: value.THROTTLE_LIMIT,
      windowSeconds: value.THROTTLE_WINDOW_SECONDS,
    },
    schedule: { tz: value.SCHEDULE_TZ },
    validator: { url: value.VALIDATOR_URL },
    web: {
      root:
        value.WEB_ROOT === undefined
          ? DEFAULT_WEB_ROOT
          : resolve(value.WEB_ROOT),
    },
  };
};

/**
 * One place: every entry point and test slice builds config the same way, so a
 * new option reaches all of them. `source` is all a caller varies.
 */
export const configModule = (source?: ConfigSource): DynamicModule =>
  ConfigModule.forRoot({
    validate,
    as: AppConfigService,
    ...(source === undefined ? {} : { source }),
  });
