import { Logger } from '@dunx/core';
import { SOCIAL_PROVIDERS, type SocialProvider } from '@gravoth/contracts';
import { socialProviders as builtInProviders } from 'better-auth/social-providers';
import { and, eq, sql } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { account, user } from '../database/schema.js';
import { providerPhoto } from '../players/avatars.js';
import type { SocialProviders } from './sign-in-providers.js';

/** One provider's user-info step, as better-auth calls it after the provider has confirmed who signed in. */
type GetUserInfo = (tokens: Record<string, unknown>) => Promise<{
  user: { id: string | number; image?: string | null | undefined };
  data: unknown;
} | null>;

/** The host a provider's photos come from, to tell whose photo `users.image` holds. */
const PHOTO_HOST: Record<SocialProvider, (hostname: string) => boolean> = {
  google: (hostname) => hostname.endsWith('.googleusercontent.com'),
  discord: (hostname) => hostname === 'cdn.discordapp.com',
};

const isSocial = (id: string): id is SocialProvider =>
  (SOCIAL_PROVIDERS as readonly string[]).includes(id);

/** How long a sign-in's photo waits for the account row it may link (the same request; a minute is generous). */
const LINK_WINDOW_MS = 60_000;

/**
 * The sign-in's photo is linked, not copied (decision 222): `users.image` holds Google's or Discord's own address, so
 * it has to follow the player's photo there. better-auth writes it only when it makes the user; its
 * `overrideUserInfoOnSignIn` would rewrite it at each sign-in, but also the name and the email address (to whatever
 * the provider now says), and only on the redirect, not on Android's ID-token sign-in. So instead every provider's
 * user-info step (`getUserInfo`, the one call both kinds of sign-in make once the provider has confirmed the person)
 * reports the photo here, and:
 *
 * - a user already signing in with that provider account gets it as `users.image`;
 * - an account row that provider sign-in then links to an existing user (`account.create.after`) gives it to that
 *   user the same way;
 * - a new user is made with it (better-auth's own `image`).
 *
 * The photo is `providerPhoto`'s: Discord's generated default avatar is no photo. A sign-in without one clears
 * `users.image` only when it held this provider's photo, so a Discord sign-in without an avatar never wipes the
 * Google photo of a player who has both.
 */
export class ProviderPhotos {
  /** `<provider>:<account id>` to the photo its last user-info step reported, for `linked`. */
  private readonly recent = new Map<
    string,
    { photo: string | null; at: number }
  >();

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  /** The providers with their user-info step reporting each photo; the stand-ins of the tests included. */
  watch(providers: SocialProviders): SocialProviders {
    const watched: Record<string, unknown> = {};
    for (const [id, options] of Object.entries(providers)) {
      if (
        options === undefined ||
        typeof options === 'function' ||
        !isSocial(id)
      ) {
        watched[id] = options;
        continue;
      }
      const own =
        (options as { getUserInfo?: GetUserInfo }).getUserInfo ??
        (builtInProviders[id](options as never).getUserInfo as GetUserInfo);
      const getUserInfo: GetUserInfo = async (tokens) => {
        const info = await own(tokens);
        if (info === null) return info;
        const photo = providerPhoto(info.user.image);
        await this.signedIn(id, String(info.user.id), photo);
        const { image: _image, ...rest } = info.user;
        return {
          ...info,
          user: photo === null ? rest : { ...rest, image: photo },
        };
      };
      watched[id] = { ...options, getUserInfo };
    }
    return watched as SocialProviders;
  }

  /** A provider confirmed `accountId`: its user, if it has one yet, shows this photo. */
  async signedIn(
    provider: SocialProvider,
    accountId: string,
    photo: string | null,
  ): Promise<void> {
    const now = Date.now();
    for (const [key, { at }] of this.recent)
      if (now - at > LINK_WINDOW_MS) this.recent.delete(key);
    this.recent.set(`${provider}:${accountId}`, { photo, at: now });
    try {
      const owners = await this.db
        .select({ userId: account.userId })
        .from(account)
        .where(
          and(
            eq(account.providerId, provider),
            eq(account.accountId, accountId),
          ),
        );
      for (const { userId } of owners)
        await this.apply(userId, provider, photo);
    } catch (error) {
      // A photo is never worth a failed sign-in.
      this.logger.warn('provider photo not refreshed', { provider, error });
    }
  }

  /** better-auth's `account.create.after`: a provider account linked to an existing user brings its photo along. */
  async linked(row: {
    userId: string;
    providerId: string;
    accountId: string;
  }): Promise<void> {
    if (!isSocial(row.providerId)) return;
    const key = `${row.providerId}:${row.accountId}`;
    const seen = this.recent.get(key);
    if (seen === undefined) return;
    this.recent.delete(key);
    try {
      await this.apply(row.userId, row.providerId, seen.photo);
    } catch (error) {
      this.logger.warn('provider photo not linked', {
        provider: row.providerId,
        error,
      });
    }
  }

  private async apply(
    userId: string,
    provider: SocialProvider,
    photo: string | null,
  ): Promise<void> {
    if (photo !== null) {
      await this.db
        .update(user)
        .set({ image: photo, updatedAt: new Date() })
        .where(
          and(
            eq(user.id, userId),
            sql`${user.image} IS DISTINCT FROM ${photo}`,
          ),
        );
      return;
    }
    const [row] = await this.db
      .select({ image: user.image })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    const held = URL.parse(row?.image ?? '');
    if (held === null || !PHOTO_HOST[provider](held.hostname)) return;
    await this.db
      .update(user)
      .set({ image: null, updatedAt: new Date() })
      .where(eq(user.id, userId));
  }
}
