import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { provide } from '@dunx/core';
import { EmailTransport, MemoryTransport } from '@dunx/infra/email';
import { isGameReturn } from './auth/game-sign-in.js';
import {
  SignInProviders,
  type SocialProviders,
} from './auth/sign-in-providers.js';
import { AppConfigService } from './config.js';
import { startTestApp, type TestApp } from './testing/app.js';

/**
 * The game's browser sign-in (decision 221), end to end over HTTP: the browser's three hops (start, the provider's
 * callback, done) with their cookies, then the game's exchange with no cookies. Discord is the stand-in from
 * accounts.test.ts: its token endpoint is answered here and its profile comes from the access token.
 */

const DISCORD = new Map<
  string,
  { id: string; email: string; global_name: string }
>([
  ['code-kai', { id: '2001', email: 'kai@example.test', global_name: 'Kai' }],
  ['code-noa', { id: '2002', email: 'noa@example.test', global_name: 'Noa' }],
  ['code-ivo', { id: '2003', email: 'ivo@example.test', global_name: 'Ivo' }],
]);

class StandInProviders extends SignInProviders {
  override social(): SocialProviders {
    return {
      discord: {
        clientId: 'test-discord-client',
        clientSecret: 'test-discord-secret',
        getUserInfo: async (tokens: { accessToken?: string | undefined }) => {
          const profile = DISCORD.get(
            tokens.accessToken?.replace(/^token-/, '') ?? '',
          );
          if (profile === undefined) return null;
          return {
            user: {
              id: profile.id,
              name: profile.global_name,
              email: profile.email,
              emailVerified: true,
            },
            data: profile,
          };
        },
      },
    };
  }
}

const PUBLIC_URL = 'https://gravoth-api.example.test';
const LOOPBACK = 'http://127.0.0.1:47811/gravoth/auth';
const STATE = 'state-0123456789abcdef';

let started: TestApp;
let base = '';
const realFetch = globalThis.fetch;

beforeAll(async () => {
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith('https://discord.com/api/oauth2/token')) {
      const body =
        init?.body instanceof URLSearchParams || typeof init?.body === 'string'
          ? init.body
          : '';
      const code = new URLSearchParams(body).get('code') ?? '';
      return Response.json({
        access_token: `token-${code}`,
        token_type: 'Bearer',
        expires_in: 604_800,
        refresh_token: 'refresh',
        scope: 'identify email',
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  started = await startTestApp({
    config: { PUBLIC_URL },
    overrides: [
      provide(EmailTransport, { useValue: new MemoryTransport() }),
      provide(SignInProviders, {
        useFactory: (config: AppConfigService) => new StandInProviders(config),
        inject: [AppConfigService],
      }),
    ],
  });
  base = started.base;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await started.close();
});

/** A path on the test server for an absolute URL the server built from PUBLIC_URL. */
const local = (absolute: string): string => {
  const url = new URL(absolute);
  return `${base}${url.pathname}${url.search}`;
};

const cookiesOf = (response: Response): string[] =>
  response.headers.getSetCookie().map((cookie) => cookie.split(';')[0] ?? '');

/** The browser's part: start, come back from Discord with `code`, then `done`. Answers where `done` sends the browser. */
const browserSignIn = async (
  discordCode: string,
  returnTo = LOOPBACK,
): Promise<{
  done: Response;
  sessionCookies: string;
}> => {
  const start = await fetch(
    `${base}/api/account/game-sign-in?${new URLSearchParams({ provider: 'discord', return: returnTo, state: STATE }).toString()}`,
    { redirect: 'manual' },
  );
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get('location') ?? '');
  expect(authorize.host).toBe('discord.com');
  expect(authorize.searchParams.get('redirect_uri')).toBe(
    `${PUBLIC_URL}/api/auth/callback/discord`,
  );
  const stateCookies = cookiesOf(start).join('; ');

  const back = await fetch(
    `${base}/api/auth/callback/discord?code=${discordCode}&state=${authorize.searchParams.get('state')}`,
    { headers: { cookie: stateCookies }, redirect: 'manual' },
  );
  expect(back.status).toBe(302);
  const toDone = back.headers.get('location') ?? '';
  expect(
    toDone.startsWith(`${PUBLIC_URL}/api/account/game-sign-in/done?`),
  ).toBe(true);
  const sessionCookies = cookiesOf(back).join('; ');

  const done = await fetch(local(toDone), {
    headers: { cookie: sessionCookies },
    redirect: 'manual',
  });
  return { done, sessionCookies };
};

const exchange = (code: string, token?: string) =>
  fetch(`${base}/api/account/game-sign-in/exchange`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ code }),
  });

const account = async (token: string) => {
  const response = await fetch(`${base}/api/account`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
};

describe('isGameReturn', () => {
  it('takes the phone link and loopback addresses only', () => {
    expect(isGameReturn('gravoth://auth')).toBe(true);
    expect(isGameReturn('http://127.0.0.1:5000/cb')).toBe(true);
    expect(isGameReturn('http://localhost:5000/')).toBe(true);
    expect(isGameReturn('gravoth://other')).toBe(false);
    expect(isGameReturn('http://127.0.0.1/cb')).toBe(false);
    expect(isGameReturn('https://127.0.0.1:5000/cb')).toBe(false);
    expect(isGameReturn('http://evil.example:5000/cb')).toBe(false);
    expect(isGameReturn('http://127.0.0.1:5000/cb?x=1')).toBe(false);
    expect(isGameReturn('http://user@127.0.0.1:5000/cb')).toBe(false);
  });
});

describe('the game signs in through the browser', () => {
  it('refuses a return address that is not the game', async () => {
    const response = await fetch(
      `${base}/api/account/game-sign-in?${new URLSearchParams({ provider: 'discord', return: 'https://evil.example/cb', state: STATE }).toString()}`,
      { redirect: 'manual' },
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe(
      'RETURN_NOT_ALLOWED',
    );
  });

  it('hands a loopback address a one-time code that becomes a session, and ends the browser session', async () => {
    const { done, sessionCookies } = await browserSignIn('code-kai');
    expect(done.status).toBe(302);
    const back = new URL(done.headers.get('location') ?? '');
    expect(`${back.origin}${back.pathname}`).toBe(LOOPBACK);
    expect(back.searchParams.get('state')).toBe(STATE);
    const code = back.searchParams.get('code') ?? '';
    expect(code.length).toBeGreaterThanOrEqual(32);

    const browser = await fetch(`${base}/api/auth/get-session`, {
      headers: { cookie: sessionCookies },
    });
    expect(await browser.json()).toBeNull();

    const traded = await exchange(code);
    expect(traded.status).toBe(200);
    const { token } = (await traded.json()) as { token: string };
    const me = await account(token);
    expect(me.status).toBe(200);
    expect(me.body['name']).toBe('Kai');
    expect(me.body['signIn']).toEqual(['discord']);

    const again = await exchange(code);
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toBe(
      'CODE_INVALID',
    );
  });

  it("opens the phone's gravoth://auth from a page", async () => {
    const { done } = await browserSignIn('code-noa', 'gravoth://auth');
    expect(done.status).toBe(200);
    const html = await done.text();
    const link = /href="(gravoth:\/\/auth\?[^"]+)"/.exec(html)?.[1] ?? '';
    const code =
      new URLSearchParams(link.replaceAll('&amp;', '&').split('?')[1]).get(
        'code',
      ) ?? '';
    expect(code.length).toBeGreaterThanOrEqual(32);
    expect((await exchange(code)).status).toBe(200);
  });

  it('sends a cancelled sign-in back with its error', async () => {
    const response = await fetch(
      `${base}/api/account/game-sign-in/done?${new URLSearchParams({ return: LOOPBACK, state: STATE, error: 'access_denied' }).toString()}`,
      { redirect: 'manual' },
    );
    expect(response.status).toBe(302);
    const back = new URL(response.headers.get('location') ?? '');
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('code')).toBeNull();
  });

  it("moves a guest's heroes onto the account it signs in to", async () => {
    const guest = await fetch(`${base}/api/auth/sign-in/anonymous`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const guestToken = guest.headers.get('set-auth-token') ?? '';
    expect(guestToken).not.toBe('');
    const made = await fetch(`${base}/api/heroes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${guestToken}`,
      },
      body: JSON.stringify({ name: 'Wren', class: 'ranger' }),
    });
    expect(made.ok).toBe(true);

    const { done } = await browserSignIn('code-ivo');
    const code =
      new URL(done.headers.get('location') ?? '').searchParams.get('code') ??
      '';
    const traded = await exchange(code, guestToken);
    expect(traded.status).toBe(200);
    const { token } = (await traded.json()) as { token: string };

    const heroes = await fetch(`${base}/api/heroes`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const { heroes: list } = (await heroes.json()) as {
      heroes: { name: string }[];
    };
    const names = list.map((hero) => hero.name);
    expect(names).toContain('Wren');
    expect((await account(guestToken)).status).toBe(401);
  });
});

describe("the game's session lasts until it signs out (decision 223)", () => {
  const YEAR_MS = 365 * 86_400_000;
  const expiryOf = async (token: string): Promise<number> => {
    const response = await fetch(`${base}/api/auth/get-session`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await response.json()) as {
      session: { expiresAt: string };
    };
    return new Date(body.session.expiresAt).getTime() - Date.now();
  };
  const guest = async (headers: Record<string, string>): Promise<string> => {
    const response = await fetch(`${base}/api/auth/sign-in/anonymous`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: '{}',
    });
    return response.headers.get('set-auth-token') ?? '';
  };

  it("gives the browser sign-in's exchange a session of decades", async () => {
    const { done } = await browserSignIn('code-kai');
    const code =
      new URL(done.headers.get('location') ?? '').searchParams.get('code') ??
      '';
    const { token } = (await (await exchange(code)).json()) as {
      token: string;
    };
    expect(await expiryOf(token)).toBeGreaterThan(40 * YEAR_MS);
  });

  it('gives a sign-in from the game (its header) a session of decades, and anything else 90 days', async () => {
    const game = await guest({ 'x-gravoth-client': 'game/0.13.0' });
    expect(await expiryOf(game)).toBeGreaterThan(40 * YEAR_MS);
    const other = await guest({});
    const days = (await expiryOf(other)) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);
  });
});
