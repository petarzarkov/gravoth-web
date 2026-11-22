import { expect } from 'bun:test';
import { provide, type Registration } from '@dunx/core';
import {
  SignInProviders,
  type SocialProviders,
} from '../auth/sign-in-providers.js';
import { AppConfigService } from '../config.js';

/**
 * Google and Discord for the suites, with everything on our side of them real: Google's ID tokens are checked
 * locally against a map (a real one needs a phone signed in to Google), and Discord's token endpoint is answered here
 * (`answerDiscordTokens`), its profiles read from a map by the access token. A suite may change a map's entry between
 * sign-ins (a new photo).
 */
export interface GoogleStandIn {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image?: string;
}

export interface DiscordStandIn {
  id: string;
  email: string;
  global_name: string;
  verified: boolean;
  image?: string;
}

class StandInProviders extends SignInProviders {
  constructor(
    config: AppConfigService,
    private readonly google: Map<string, GoogleStandIn>,
    private readonly discord: Map<string, DiscordStandIn>,
  ) {
    super(config);
  }

  override social(): SocialProviders {
    return {
      google: {
        clientId: 'test-web-client',
        clientSecret: 'test-web-secret',
        verifyIdToken: async (token: string) => this.google.has(token),
        getUserInfo: async (tokens: { idToken?: string | undefined }) => {
          const profile = this.google.get(tokens.idToken ?? '');
          return profile === undefined
            ? null
            : { user: profile, data: profile };
        },
      },
      discord: {
        clientId: 'test-discord-client',
        clientSecret: 'test-discord-secret',
        getUserInfo: async (tokens: { accessToken?: string | undefined }) => {
          const profile = this.discord.get(
            tokens.accessToken?.replace(/^token-/, '') ?? '',
          );
          if (profile === undefined) return null;
          return {
            user: {
              id: profile.id,
              name: profile.global_name,
              email: profile.email,
              emailVerified: profile.verified,
              ...(profile.image === undefined ? {} : { image: profile.image }),
            },
            data: profile,
          };
        },
      },
    };
  }
}

/** The override that puts the stand-ins in place of the configured providers. */
export const standInProviders = (
  google: Map<string, GoogleStandIn>,
  discord: Map<string, DiscordStandIn>,
): Registration =>
  // A class override is built lazily by the container, so it is handed its config.
  provide(SignInProviders, {
    useFactory: (config: AppConfigService) =>
      new StandInProviders(config, google, discord),
    inject: [AppConfigService],
  });

/** Discord's token endpoint, answered here: code `code-x` becomes access token `token-code-x`. Returns the undo. */
export const answerDiscordTokens = (): (() => void) => {
  const realFetch = globalThis.fetch;
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
      const code =
        new URLSearchParams(
          init?.body instanceof URLSearchParams ||
            typeof init?.body === 'string'
            ? init.body
            : '',
        ).get('code') ?? '';
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
  return () => {
    globalThis.fetch = realFetch;
  };
};

/**
 * The browser half of a Discord sign-in: ask for the authorization URL, "come back" from Discord with a code to the
 * callback (with the state cookie the first step set), and read the session token off the redirect.
 */
export const discordSignIn = async (
  base: string,
  code: string,
  token?: string,
): Promise<{ location: string; token: string | null; url: URL }> => {
  const start = await fetch(`${base}/api/auth/sign-in/social`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({
      provider: 'discord',
      callbackURL: '/api/account/email-verified',
    }),
  });
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const authorize = new URL(url);
  const cookies = start.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
  const back = await fetch(
    `${base}/api/auth/callback/discord?code=${code}&state=${authorize.searchParams.get('state')}`,
    {
      headers: { cookie: cookies },
      redirect: 'manual',
    },
  );
  return {
    location: back.headers.get('location') ?? '',
    token: back.headers.get('set-auth-token'),
    url: authorize,
  };
};
