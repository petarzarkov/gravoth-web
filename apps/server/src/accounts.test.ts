import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { provide } from '@dunx/core';
import { EmailTransport, MemoryTransport } from '@dunx/infra/email';
import { AppConfigService } from './config.js';
import { SignInProviders, type SocialProviders } from './auth/sign-in-providers.js';
import { startTestApp, type TestApp } from './testing/app.js';

/**
 * Step 2, accounts, end to end over HTTP the way the game calls them: a bearer token
 * from `set-auth-token`, no cookies, no Origin header. Mail is caught by a memory
 * transport; Google is a stand-in whose ID tokens are checked locally, since a real
 * one needs a phone signed in to Google (the rest of the flow is the real code).
 */

/** ID tokens the stand-in Google accepts, and the profile each one carries. */
const GOOGLE_TOKENS = new Map<string, { id: string; email: string; name: string; emailVerified: boolean }>([
  ['google-ana', { id: 'g-ana', email: 'ana@example.test', name: 'Ana', emailVerified: true }],
  ['google-guest', { id: 'g-guest', email: 'guest-upgrade@example.test', name: 'Bo', emailVerified: true }],
  ['google-lin', { id: 'g-lin', email: 'lin@example.test', name: 'Lin', emailVerified: true }],
  ['google-eve', { id: 'g-eve', email: 'eve@example.test', name: 'Eve', emailVerified: true }],
  ['google-sol', { id: 'g-sol', email: 'sol@example.test', name: 'Sol G', emailVerified: true }],
]);

/**
 * Discord's side of the redirect: the access token each authorization code is exchanged for, and the profile behind
 * it. Discord's token endpoint is answered locally (below); everything on our side of it is the real flow.
 */
const DISCORD_CODES = new Map<string, { id: string; email: string; global_name: string; verified: boolean }>([
  ['code-rin', { id: '1001', email: 'rin@example.test', global_name: 'Rin', verified: true }],
  ['code-ana', { id: '1002', email: 'ana@example.test', global_name: 'Ana D', verified: true }],
  ['code-mallory', { id: '1003', email: 'mallory@example.test', global_name: 'Mallory', verified: false }],
]);

class StandInProviders extends SignInProviders {
  override social(): SocialProviders {
    return {
      google: {
        clientId: 'test-web-client',
        clientSecret: 'test-web-secret',
        verifyIdToken: async (token: string) => GOOGLE_TOKENS.has(token),
        getUserInfo: async (tokens: { idToken?: string | undefined }) => {
          const profile = GOOGLE_TOKENS.get(tokens.idToken ?? '');
          return profile === undefined ? null : { user: profile, data: profile };
        },
      },
      discord: {
        clientId: 'test-discord-client',
        clientSecret: 'test-discord-secret',
        getUserInfo: async (tokens: { accessToken?: string | undefined }) => {
          const profile = DISCORD_CODES.get(tokens.accessToken?.replace(/^token-/, '') ?? '');
          if (profile === undefined) return null;
          return { user: { id: profile.id, name: profile.global_name, email: profile.email, emailVerified: profile.verified }, data: profile };
        },
      },
    };
  }
}

/** The public origin the server builds its redirect URIs from in this suite. */
const PUBLIC_URL = 'https://gravoth-api.example.test';

const mail = new MemoryTransport();
let started: TestApp;
let base = '';
const realFetch = globalThis.fetch;

beforeAll(async () => {
  // Discord's token endpoint, answered here: code `code-x` becomes access token `token-code-x`.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://discord.com/api/oauth2/token')) {
      const code = new URLSearchParams(String(init?.body ?? '')).get('code') ?? '';
      return Response.json({ access_token: `token-${code}`, token_type: 'Bearer', expires_in: 604_800, refresh_token: 'refresh', scope: 'identify email' });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  started = await startTestApp({
    config: { PUBLIC_URL },
    overrides: [
      provide(EmailTransport, { useValue: mail }),
      // A class override is built lazily by the container, so it is handed its config.
      provide(SignInProviders, { useFactory: (config: AppConfigService) => new StandInProviders(config), inject: [AppConfigService] }),
    ],
  });
  base = started.base;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await started.close();
});

/**
 * The browser half of a Discord sign-in: ask for the authorization URL, "come back" from Discord with a code to the
 * callback (with the state cookie the first step set), and read the session token off the redirect.
 */
const discordSignIn = async (code: string, token?: string): Promise<{ location: string; token: string | null; url: URL }> => {
  const start = await fetch(`${base}/api/auth/sign-in/social`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify({ provider: 'discord', callbackURL: '/api/account/email-verified' }),
  });
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const authorize = new URL(url);
  const cookies = start.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
  const back = await fetch(`${base}/api/auth/callback/discord?code=${code}&state=${authorize.searchParams.get('state')}`, {
    headers: { cookie: cookies },
    redirect: 'manual',
  });
  return { location: back.headers.get('location') ?? '', token: back.headers.get('set-auth-token'), url: authorize };
};

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
  token: string | null;
}

const auth = async <T = Record<string, unknown>>(endpoint: string, body: unknown, token?: string): Promise<Reply<T>> => {
  const response = await fetch(`${base}/api/auth/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T, token: response.headers.get('set-auth-token') };
};

interface Account {
  id: string;
  name: string;
  email: string | null;
  emailVerified: boolean;
  guest: boolean;
  signIn: string[];
  createdAt: string;
}

const account = async (token: string): Promise<{ status: number; body: Account }> => {
  const response = await fetch(`${base}/api/account`, { headers: { authorization: `Bearer ${token}` } });
  return { status: response.status, body: (await response.json()) as Account };
};

const deleteAccount = async (token: string, body: unknown = {}): Promise<number> =>
  (
    await fetch(`${base}/api/account/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  ).status;

/** The one link in the last mail to `address`. */
const linkIn = (address: string): string => {
  const sent = mail.to(address).at(-1);
  expect(sent).toBeDefined();
  const link = sent?.text?.match(/https?:\/\/\S+/)?.[0];
  expect(link).toBeDefined();
  return link ?? '';
};

const guest = async (): Promise<string> => {
  const reply = await auth<{ token: string; user: { isAnonymous: boolean } }>('sign-in/anonymous', {});
  expect(reply.status).toBe(200);
  expect(reply.body.user.isAnonymous).toBe(true);
  expect(reply.token).not.toBeNull();
  return reply.token ?? '';
};

describe('the sign-in methods', () => {
  it('lists guest, email and every configured provider: Google and Discord', async () => {
    const response = await fetch(`${base}/api/account/methods`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ methods: ['guest', 'email', 'google', 'discord'] });
  });

  it('refuses /api/account with no session', async () => {
    expect((await fetch(`${base}/api/account`)).status).toBe(401);
    expect((await fetch(`${base}/api/account`, { headers: { authorization: 'Bearer forged' } })).status).toBe(401);
  });
});

describe('a guest', () => {
  it('is made with no credentials and sees itself as a guest', async () => {
    const token = await guest();

    const { status, body } = await account(token);
    expect(status).toBe(200);
    expect(body).toMatchObject({ name: 'Guest', email: null, guest: true, signIn: [], emailVerified: false });
  });

  it('becomes an email account by signing up with its token; the guest is gone', async () => {
    const token = await guest();
    const guestId = (await account(token)).body.id;

    const signUp = await auth('sign-up/email', { email: 'mira@example.test', password: 'a long enough password', name: 'Mira' }, token);
    expect(signUp.status).toBe(200);
    expect(signUp.token).not.toBeNull();

    const upgraded = await account(signUp.token ?? '');
    expect(upgraded.body).toMatchObject({ email: 'mira@example.test', guest: false, signIn: ['email'], emailVerified: false });
    expect(upgraded.body.id).not.toBe(guestId);
    expect((await account(token)).status).toBe(401);
  });

  it('becomes a Google account by signing in with its token', async () => {
    const token = await guest();

    const signIn = await auth('sign-in/social', { provider: 'google', idToken: { token: 'google-guest' } }, token);
    expect(signIn.status).toBe(200);

    expect((await account(signIn.token ?? '')).body).toMatchObject({ guest: false, signIn: ['google'], email: 'guest-upgrade@example.test' });
    expect((await account(token)).status).toBe(401);
  });

  it('is deleted with its session alone', async () => {
    const token = await guest();

    expect(await deleteAccount(token)).toBe(200);
    expect((await account(token)).status).toBe(401);
  });

  it('is never sent a mail', () => {
    expect(mail.sent.every((sent) => sent.to.every((to) => !to.address.endsWith('.invalid')))).toBe(true);
  });
});

describe('email and password', () => {
  const email = 'sol@example.test';
  const password = 'correct horse battery';
  let token = '';

  it('signs up, and a confirmation mail goes out', async () => {
    const signUp = await auth('sign-up/email', { email, password, name: 'Sol' });
    expect(signUp.status).toBe(200);
    token = signUp.token ?? '';

    expect(mail.to(email)).toHaveLength(1);
    expect(mail.to(email)[0]?.subject).toBe('Confirm your Gravoth account');
    expect(linkIn(email)).toContain('/api/auth/verify-email?token=');
  });

  it('confirms the address from the mail link, landing on the confirmation page', async () => {
    const link = linkIn(email);
    const followed = await fetch(link.replace(/^https?:\/\/[^/]+/, base), { redirect: 'manual' });

    expect(followed.status).toBe(302);
    const landing = followed.headers.get('location') ?? '';
    expect(landing).toStartWith('/api/account/email-verified');
    const page = await fetch(`${base}${landing}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Address confirmed');
    expect((await account(token)).body.emailVerified).toBe(true);
  });

  it('shows an expired confirmation link as such', async () => {
    const page = await fetch(`${base}/api/account/email-verified?error=INVALID_TOKEN`);

    expect(page.status).toBe(400);
    expect(await page.text()).toContain('Link expired');
  });

  it('signs in, and refuses a wrong password, an unknown address and a short password', async () => {
    expect((await auth('sign-in/email', { email, password })).status).toBe(200);
    expect((await auth('sign-in/email', { email, password: 'not the password' })).status).toBe(401);
    expect((await auth('sign-in/email', { email: 'nobody@example.test', password })).status).toBe(401);
    expect((await auth('sign-up/email', { email: 'short@example.test', password: 'short', name: 'S' })).status).toBe(400);
    expect((await auth('sign-up/email', { email, password, name: 'Sol again' })).status).toBe(422);
  });

  it('resets a forgotten password through the mailed page, signing every device out', async () => {
    expect((await auth('request-password-reset', { email })).status).toBe(200);
    const link = linkIn(email);
    expect(mail.to(email).at(-1)?.subject).toBe('Reset your Gravoth password');
    expect(link).toContain('/api/account/reset-password?token=');

    const resetToken = new URL(link).searchParams.get('token') ?? '';
    const form = await fetch(`${base}/api/account/reset-password?token=${encodeURIComponent(resetToken)}`);
    expect(form.status).toBe(200);
    expect(await form.text()).toContain('name="newPassword"');

    const tooShort = await fetch(`${base}/api/account/reset-password`, {
      method: 'POST',
      body: new URLSearchParams({ token: resetToken, newPassword: 'short' }),
    });
    expect(tooShort.status).toBe(400);

    const saved = await fetch(`${base}/api/account/reset-password`, {
      method: 'POST',
      body: new URLSearchParams({ token: resetToken, newPassword: 'a brand new password' }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.text()).toContain('Password changed');

    expect((await account(token)).status).toBe(401);
    expect((await auth('sign-in/email', { email, password })).status).toBe(401);
    const again = await auth('sign-in/email', { email, password: 'a brand new password' });
    expect(again.status).toBe(200);
    token = again.token ?? '';

    const reused = await fetch(`${base}/api/account/reset-password`, {
      method: 'POST',
      body: new URLSearchParams({ token: resetToken, newPassword: 'yet another password' }),
    });
    expect(reused.status).toBe(400);
    expect(await reused.text()).toContain('Link expired');
  });

  it('answers a reset request for an unknown address the same way, sending nothing', async () => {
    const before = mail.sent.length;

    expect((await auth('request-password-reset', { email: 'nobody@example.test' })).status).toBe(200);
    expect(mail.sent.length).toBe(before);
  });

  it('joins Google to the account once both have confirmed the same address', async () => {
    const mine = (await account(token)).body;
    const google = await auth('sign-in/social', { provider: 'google', idToken: { token: 'google-sol' } });
    expect(google.status).toBe(200);
    const joined = (await account(google.token ?? '')).body;
    expect(joined.id).toBe(mine.id);
    expect([...joined.signIn].sort()).toEqual(['email', 'google']);

    const signIn = await auth('sign-in/social', { provider: 'google', idToken: { token: 'google-lin' } });
    expect(signIn.status).toBe(200);
    // A different address: its own new account.
    expect((await account(signIn.token ?? '')).body.signIn).toEqual(['google']);

    const signUp = await auth('sign-up/email', { email: 'eve@example.test', password, name: 'Eve' });
    expect(signUp.status).toBe(200);
    // Eve has not confirmed her address, so Google's word for it does not join them.
    expect((await auth('sign-in/social', { provider: 'google', idToken: { token: 'google-eve' } })).status).toBe(401);
  });

  it('needs the password to delete the account', async () => {
    expect(await deleteAccount(token)).toBe(400);
    expect(await deleteAccount(token, { password: 'not the password' })).toBe(403);
    expect(await deleteAccount(token, { password: 'a brand new password' })).toBe(200);

    expect((await account(token)).status).toBe(401);
    expect((await auth('sign-in/email', { email, password: 'a brand new password' })).status).toBe(401);
  });
});

describe('Google', () => {
  it('makes an account from an ID token, and signs the same player into it again', async () => {
    const first = await auth('sign-in/social', { provider: 'google', idToken: { token: 'google-ana' } });
    expect(first.status).toBe(200);
    const mine = await account(first.token ?? '');
    expect(mine.body).toMatchObject({ name: 'Ana', email: 'ana@example.test', emailVerified: true, guest: false, signIn: ['google'] });

    const second = await auth('sign-in/social', { provider: 'google', idToken: { token: 'google-ana' } });
    expect((await account(second.token ?? '')).body.id).toBe(mine.body.id);
  });

  it('refuses an ID token the provider does not vouch for', async () => {
    expect((await auth('sign-in/social', { provider: 'google', idToken: { token: 'forged' } })).status).toBe(401);
  });

  it('refuses a provider this server has no client for', async () => {
    expect((await auth('sign-in/social', { provider: 'apple', idToken: { token: 'any' } })).status).toBe(404);
  });

  it('deletes a Google-only account with its session', async () => {
    const signIn = await auth('sign-in/social', { provider: 'google', idToken: { token: 'google-ana' } });

    expect(await deleteAccount(signIn.token ?? '')).toBe(200);
    expect((await account(signIn.token ?? '')).status).toBe(401);
  });
});

describe('the reset page', () => {
  it('turns away a missing or unknown code', async () => {
    expect(await (await fetch(`${base}/api/account/reset-password`)).text()).toContain('Link incomplete');

    const unknown = await fetch(`${base}/api/account/reset-password`, {
      method: 'POST',
      body: new URLSearchParams({ token: 'not-a-real-code', newPassword: 'a long enough password' }),
    });
    expect(unknown.status).toBe(400);
  });

  it('escapes the code it echoes into the form', async () => {
    const page = await (await fetch(`${base}/api/account/reset-password?token=${encodeURIComponent('"><script>x</script>')}`)).text();

    expect(page).not.toContain('<script>');
  });
});

describe('Discord', () => {
  it('sends the browser to Discord with the redirect URI registered there', async () => {
    const { url } = await discordSignIn('code-unused');

    expect(url.origin + url.pathname).toBe('https://discord.com/api/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('test-discord-client');
    expect(url.searchParams.get('redirect_uri')).toBe(`${PUBLIC_URL}/api/auth/callback/discord`);
    expect(url.searchParams.get('scope')).toBe('identify email');
  });

  it("makes an account from Discord's callback, and signs the same player into it again", async () => {
    const first = await discordSignIn('code-rin');
    expect(first.location).toContain('/api/account/email-verified');
    expect(first.token).not.toBeNull();
    const mine = await account(first.token ?? '');
    expect(mine.body).toMatchObject({ name: 'Rin', email: 'rin@example.test', emailVerified: true, guest: false, signIn: ['discord'] });

    const again = await discordSignIn('code-rin');
    expect((await account(again.token ?? '')).body.id).toBe(mine.body.id);
  });

  it('joins the account whose address it shares, both sides confirmed', async () => {
    const google = await auth('sign-in/social', { provider: 'google', idToken: { token: 'google-ana' } });
    const mine = (await account(google.token ?? '')).body;

    const discord = await discordSignIn('code-ana');
    const joined = (await account(discord.token ?? '')).body;
    expect(joined.id).toBe(mine.id);
    expect(joined.signIn).toEqual(['discord', 'google']);
  });

  it("never joins an address Discord has not confirmed to someone else's account", async () => {
    expect((await auth('sign-up/email', { email: 'mallory@example.test', password: 'a long enough password', name: 'Mal' })).status).toBe(200);

    const refused = await discordSignIn('code-mallory');
    expect(refused.token).toBeNull();
    expect(refused.location).toContain('error=');
  });
});
