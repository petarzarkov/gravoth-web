import { describe, expect, it } from 'bun:test';
import { validate } from './config.js';

/** What the server refuses to boot with, so a missing secret on the Pi is a boot error, not a public key. */
describe('config', () => {
  const secret = 'x'.repeat(48);
  const production = {
    NODE_ENV: 'production',
    AUTH_SECRET: secret,
    POSTGRES_PASSWORD: 'a-real-database-password',
  };

  const messageOf = (env: Record<string, string>): string => {
    try {
      validate(env);
    } catch (error) {
      return (error as Error).message;
    }
    return '';
  };

  it('boots a development checkout with nothing set', () => {
    const config = validate({});

    expect(config.production).toBe(false);
    expect(config.google).toBeUndefined();
    expect(config.discord).toBeUndefined();
    expect(config.mail.resendApiKey).toBeUndefined();
    expect(config.backup.r2).toBeUndefined();
    expect(config.database.url).toBe(
      'postgres://gravoth:gravoth-local@localhost:5432/gravoth',
    );
    expect(config.publicUrl).toBe('http://localhost:3000');
  });

  it('refuses production on the development secret, naming the variable but no value', () => {
    const message = messageOf({
      NODE_ENV: 'production',
      POSTGRES_PASSWORD: 'a-real-database-password',
    });

    expect(message).toContain('AUTH_SECRET');
    expect(message).toContain('server/.env');
    expect(message).not.toContain('dunx-development-secret');
  });

  it('refuses a secret under 32 characters', () => {
    expect(() => validate({ ...production, AUTH_SECRET: 'short' })).toThrow(
      'AUTH_SECRET',
    );
  });

  it('refuses production on the local database password, naming the variable but no value', () => {
    const message = messageOf({ NODE_ENV: 'production', AUTH_SECRET: secret });

    expect(message).toContain('POSTGRES_PASSWORD');
    expect(message).not.toContain('gravoth-local');
  });

  it('accepts production with a real secret and database password, served at the public hostname', () => {
    const config = validate(production);

    expect(config.production).toBe(true);
    expect(config.auth.secret).toBe(secret);
    expect(config.publicUrl).toBe('https://gravoth-api.petarzarkov.com');
  });

  it('builds the database URL from its parts, encoding the password; DATABASE_URL wins', () => {
    const built = validate({
      POSTGRES_HOST: 'postgres',
      POSTGRES_PASSWORD: 'p@ss/word#1',
      POSTGRES_DB: 'gravoth',
    });
    expect(built.database.url).toBe(
      'postgres://gravoth:p%40ss%2Fword%231@postgres:5432/gravoth',
    );
    expect(new URL(built.database.url).password).toBe('p%40ss%2Fword%231');

    expect(
      validate({ DATABASE_URL: 'postgres://u:p@db:6543/x' }).database.url,
    ).toBe('postgres://u:p@db:6543/x');
  });

  it('takes each OAuth client as a pair or not at all', () => {
    expect(() => validate({ GOOGLE_CLIENT_ID: 'id' })).toThrow(
      'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET',
    );
    expect(() => validate({ DISCORD_CLIENT_SECRET: 'shh' })).toThrow(
      'DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET',
    );

    const both = validate({
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'shh',
      DISCORD_CLIENT_ID: 'd',
      DISCORD_CLIENT_SECRET: 'ds',
    });
    expect(both.google).toEqual({ clientId: 'id', clientSecret: 'shh' });
    expect(both.discord).toEqual({ clientId: 'd', clientSecret: 'ds' });
  });

  it('sends mail through Resend only with its key, from no-reply@mail.petarzarkov.com by default', () => {
    expect(validate({}).mail).toEqual({
      resendApiKey: undefined,
      from: 'Gravoth <no-reply@mail.petarzarkov.com>',
    });
    expect(
      validate({
        RESEND_API_KEY: 're_test',
        MAIL_FROM: 'Gravoth <hi@mail.example.test>',
      }).mail,
    ).toEqual({
      resendApiKey: 're_test',
      from: 'Gravoth <hi@mail.example.test>',
    });
  });

  it('takes the R2 bucket as all four variables or none', () => {
    expect(() => validate({ R2_BUCKET: 'gravoth-backups' })).toThrow(
      'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET',
    );

    const backup = validate({
      R2_ACCOUNT_ID: 'acc',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'gravoth-backups',
    }).backup;
    expect(backup).toEqual({
      r2: {
        accountId: 'acc',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        bucket: 'gravoth-backups',
      },
      keepDays: 30,
    });
  });
});
