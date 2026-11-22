import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { symmetricDecrypt } from 'better-auth/crypto';
import { looksEncrypted, sealAccountTokens } from './auth/oauth-tokens.js';
import { startTestApp, type TestApp } from './testing/app.js';
import { call, signUp } from './testing/http.js';
import {
  answerDiscordTokens,
  discordSignIn,
  standInProviders,
  type DiscordStandIn,
  type GoogleStandIn,
} from './testing/stand-ins.js';

/**
 * The providers' tokens at rest (decision 224): a Google or Discord sign-in still works with the stand-ins
 * (testing/stand-ins.ts), and what it leaves in `accounts` is the access and refresh tokens encrypted with AUTH_SECRET
 * and no ID token, whichever route wrote them; a plaintext token from before still reads as it is.
 */
const SECRET = 'a test secret that is long enough for better-auth';

const GOOGLE = new Map<string, GoogleStandIn>([
  [
    'google-ida',
    {
      id: 'g-ida',
      email: 'ida@example.test',
      name: 'Ida',
      emailVerified: true,
    },
  ],
  [
    'google-lin',
    {
      id: 'g-lin',
      email: 'lin@example.test',
      name: 'Lin',
      emailVerified: true,
    },
  ],
]);

const DISCORD = new Map<string, DiscordStandIn>([
  [
    'code-ren',
    {
      id: '2001',
      email: 'ren@example.test',
      global_name: 'Ren',
      verified: true,
    },
  ],
  [
    'code-old',
    {
      id: '2002',
      email: 'old@example.test',
      global_name: 'Old',
      verified: true,
    },
  ],
]);

let started: TestApp;
let base = '';
let db: SQL;
let restoreFetch = () => {};

beforeAll(async () => {
  restoreFetch = answerDiscordTokens();
  started = await startTestApp({
    config: { AUTH_SECRET: SECRET },
    overrides: [standInProviders(GOOGLE, DISCORD)],
  });
  base = started.base;
  db = new SQL(started.database.url, { max: 1 });
});

afterAll(async () => {
  restoreFetch();
  await db.close();
  await started.close();
});

interface TokenRow {
  access_token: string | null;
  refresh_token: string | null;
  id_token: string | null;
}

const tokensOf = async (provider: string, accountId: string) => {
  const rows = (await db`
    SELECT access_token, refresh_token, id_token FROM accounts
    WHERE provider_id = ${provider} AND account_id = ${accountId}`) as TokenRow[];
  expect(rows).toHaveLength(1);
  return rows[0] as TokenRow;
};

const opened = (token: string | null) =>
  symmetricDecrypt({ key: SECRET, data: token ?? '' });

describe('the OAuth tokens at rest', () => {
  it('keeps a Discord sign-in working, its tokens encrypted, at sign-up and at every sign-in after', async () => {
    const first = await discordSignIn(base, 'code-ren');
    expect(first.token).not.toBeNull();
    const made = await tokensOf('discord', '2001');
    expect(made.access_token).not.toBe('token-code-ren');
    expect(made.refresh_token).not.toBe('refresh');
    expect(looksEncrypted(made.access_token ?? '')).toBe(true);
    expect(await opened(made.access_token)).toBe('token-code-ren');
    expect(await opened(made.refresh_token)).toBe('refresh');
    expect(made.id_token).toBeNull();

    // The next sign-in updates the row: encrypted again, with a fresh nonce.
    const second = await discordSignIn(base, 'code-ren');
    const me = await call<{ email: string }>(base, 'GET', '/api/account', {
      token: second.token ?? '',
    });
    expect(me.body.email).toBe('ren@example.test');
    const again = await tokensOf('discord', '2001');
    expect(again.access_token).not.toBe(made.access_token);
    expect(await opened(again.access_token)).toBe('token-code-ren');
  });

  it('keeps no ID token from a Google sign-in', async () => {
    const reply = await call(base, 'POST', '/api/auth/sign-in/social', {
      body: { provider: 'google', idToken: { token: 'google-ida' } },
    });
    expect(reply.status).toBe(200);
    expect(reply.token).not.toBeNull();
    expect(await tokensOf('google', 'g-ida')).toEqual({
      access_token: null,
      refresh_token: null,
      id_token: null,
    });
  });

  it('encrypts the tokens of a provider linked by ID token, the route better-auth writes them plain on', async () => {
    const lin = await signUp(base, 'Lin', 'lin@example.test');
    const linked = await call(base, 'POST', '/api/auth/link-social', {
      token: lin.token,
      body: {
        provider: 'google',
        idToken: {
          token: 'google-lin',
          accessToken: 'plain-access',
          refreshToken: 'plain-refresh',
        },
      },
    });
    expect(linked.status).toBe(200);
    const row = await tokensOf('google', 'g-lin');
    expect(row.id_token).toBeNull();
    expect(await opened(row.access_token)).toBe('plain-access');
    expect(await opened(row.refresh_token)).toBe('plain-refresh');
  });

  it("reads a plaintext token from before as it is, and an encrypted one as the provider's", async () => {
    const old = await discordSignIn(base, 'code-old');
    const later = new Date(Date.now() + 3_600_000);
    await db`UPDATE accounts SET access_token = 'an-old-plain-token', access_token_expires_at = ${later}
      WHERE provider_id = 'discord' AND account_id = '2002'`;
    const plain = await call<{ accessToken: string }>(
      base,
      'POST',
      '/api/auth/get-access-token',
      { token: old.token ?? '', body: { providerId: 'discord' } },
    );
    expect(plain.status).toBe(200);
    expect(plain.body.accessToken).toBe('an-old-plain-token');

    const fresh = await discordSignIn(base, 'code-old');
    await db`UPDATE accounts SET access_token_expires_at = ${later}
      WHERE provider_id = 'discord' AND account_id = '2002'`;
    const sealed = await call<{ accessToken: string }>(
      base,
      'POST',
      '/api/auth/get-access-token',
      { token: fresh.token ?? '', body: { providerId: 'discord' } },
    );
    expect(sealed.body.accessToken).toBe('token-code-old');
  });
});

describe('sealAccountTokens', () => {
  it('encrypts what is plain, leaves what is encrypted or absent, and drops an ID token', async () => {
    const sealed = await sealAccountTokens(
      { accessToken: 'ya29.plain', refreshToken: 'abcdef12', idToken: 'x.y.z' },
      SECRET,
    );
    expect(await opened(sealed.accessToken as string)).toBe('ya29.plain');
    // Even-length hex already reads as encrypted to better-auth, so it is left for its own decryption.
    expect(sealed.refreshToken).toBe('abcdef12');
    expect(sealed.idToken).toBeNull();
    expect(await sealAccountTokens({ scope: 'email' }, SECRET)).toEqual({
      scope: 'email',
    });
  });
});
