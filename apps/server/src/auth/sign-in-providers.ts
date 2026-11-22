import type { SignInMethod, SocialProvider } from '@gravoth/contracts';
import type { BetterAuthOptions } from 'better-auth';
import { AppConfigService } from '../config.js';

/** better-auth's per-provider settings map (`google`, `discord`, ...). */
export type SocialProviders = NonNullable<BetterAuthOptions['socialProviders']>;

export type { SignInMethod };

/**
 * The third-party sign-ins this server accepts, behind one provider-neutral door: no store or platform game service
 * is involved (no Play Games, no Game Center). At launch: **Google** and **Discord**, beside our own email and
 * password accounts and guests (decided 2026-11-22).
 *
 * Every provider is plain OAuth 2 / OpenID Connect through better-auth, at `POST /api/auth/sign-in/social`:
 *
 * - **A browser redirect with PKCE** (the website, PC, and Discord everywhere): the endpoint answers the provider's
 *   authorization URL, and the provider comes back to `<PUBLIC_URL>/api/auth/callback/<provider>`, the redirect URI
 *   registered with it.
 * - **An ID token** the device already holds (Android's Credential Manager "Sign in with Google"): `{ provider,
 *   idToken: { token } }`. better-auth checks the signature, issuer and audience (the Web client id) against Google's
 *   published keys. Discord issues no ID tokens, so it is the redirect only.
 *
 * A provider is offered only while both its variables are set; a provider without them is simply absent from
 * `/api/account/methods` and refused by the door. Adding one (Apple with the iOS port) is a block here and its two
 * variables in config.ts.
 *
 * A class so a test can replace the providers with ones whose token checks are local.
 */
export class SignInProviders {
  constructor(private readonly config: AppConfigService) {}

  social(): SocialProviders {
    const google = this.config.get('google');
    const discord = this.config.get('discord');
    return {
      ...(google === undefined
        ? {}
        : {
            google: {
              // The Web client: the audience Android asks Credential Manager to mint ID tokens for (its server client
              // id), and the client the browser redirect signs in with.
              clientId: google.clientId,
              clientSecret: google.clientSecret,
              prompt: 'select_account' as const,
            },
          }),
      ...(discord === undefined
        ? {}
        : {
            discord: {
              clientId: discord.clientId,
              clientSecret: discord.clientSecret,
              // `identify` and `email` (better-auth's default scopes): the name, and the address account linking needs.
            },
          }),
    };
  }

  /** What the game's SIGN IN row may show, in the order it shows them. */
  methods(): readonly SignInMethod[] {
    return ['guest', 'email', ...(Object.keys(this.social()) as SocialProvider[])];
  }
}
