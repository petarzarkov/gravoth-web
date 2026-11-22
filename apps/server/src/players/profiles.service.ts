import { HttpError, HttpStatusCode } from '@dunx/http';
import { eq, sql } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { isUniqueViolation } from '../database/errors.js';
import { profile, user, type Profile } from '../database/schema.js';
import { avatarView, providerPhoto, randomPortrait } from './avatars.js';
import {
  baseDisplayName,
  displayNameProblem,
  FALLBACK_NAME,
  withDigits,
} from './display-names.js';
import type { AvatarChoice, ProfileView } from '@gravoth/contracts';
export type { ProfileView };

/** What the player may change on their own profile. */
export interface ProfileChanges {
  readonly displayName?: string | undefined;
  readonly publicProfile?: boolean | undefined;
  readonly allowFriendRequests?: boolean | undefined;
  readonly showOnline?: boolean | undefined;
  readonly emailFriendRequests?: boolean | undefined;
  readonly avatar?: AvatarChoice | undefined;
}

/** The owner's view of a profile; `image` is the user's sign-in photo (`users.image`). */
export const toProfileView = (
  row: Profile,
  image: string | null | undefined,
): ProfileView => ({
  userId: row.userId,
  displayName: row.displayName,
  nameChosen: row.nameChosen,
  publicProfile: row.publicProfile,
  allowFriendRequests: row.allowFriendRequests,
  showOnline: row.showOnline,
  emailFriendRequests: row.emailFriendRequests,
  avatar: avatarView(row, image),
  hasProviderPhoto: providerPhoto(image) !== null,
});

/**
 * Profiles: made with the user (better-auth's `user.create.after` hook in auth.module.ts) under a free name made from
 * the sign-in's own (`Sol`, `Guest4821`), renamed by the player under the word filter, gone with the user.
 *
 * The picture starts as the sign-in's photo when it brought one (Google, Discord), else a random portrait; the player
 * picks either later (`avatar` in `update`).
 */
export class Profiles {
  constructor(private readonly db: Db) {}

  /** The user's profile, made now if the sign-up's hook never ran (a crash between the two). */
  async ensure(userId: string, name = 'Hero', guest = false): Promise<Profile> {
    const existing = await this.find(userId);
    if (existing !== undefined) return existing;
    return this.create(userId, name, guest);
  }

  async find(userId: string): Promise<Profile | undefined> {
    const [row] = await this.db
      .select()
      .from(profile)
      .where(eq(profile.userId, userId))
      .limit(1);
    return row;
  }

  /** By display name, without regard to case (the unique index's own expression). */
  /** The user's sign-in photo as stored (`users.image`), unchecked: `providerPhoto` decides whether it shows. */
  async imageOf(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ image: user.image })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return row?.image ?? null;
  }

  /** The owner's view: the profile (made now if missing) with its picture. */
  async view(
    userId: string,
    name = 'Hero',
    guest = false,
  ): Promise<ProfileView> {
    const row = await this.ensure(userId, name, guest);
    return toProfileView(row, await this.imageOf(userId));
  }

  async findByName(displayName: string): Promise<Profile | undefined> {
    const [row] = await this.db
      .select()
      .from(profile)
      .where(sql`lower(${profile.displayName}) = lower(${displayName})`)
      .limit(1);
    return row;
  }

  /**
   * A first profile under a free name: the sign-in's name if nobody has it (never for a guest, who are all `Guest`),
   * else that name with four digits, then six. The unique index decides a race; a lost one tries the next name. The
   * picture is the sign-in's photo when the user has one, else the random portrait (which stays as the photo's stand-in).
   */
  async create(userId: string, name: string, guest: boolean): Promise<Profile> {
    const base = guest ? 'Guest' : baseDisplayName(name);
    const avatar = {
      avatarKind:
        providerPhoto(await this.imageOf(userId)) === null
          ? ('portrait' as const)
          : ('provider' as const),
      avatarPortrait: randomPortrait(),
    };
    const candidates = [
      // A fallback (`Hero`) or a guest's name is never taken bare: there would be only one of each.
      ...(guest || base === FALLBACK_NAME ? [] : [base]),
      ...Array.from({ length: 6 }, () => withDigits(base.slice(0, 16), 4)),
      ...Array.from({ length: 6 }, () => withDigits(base.slice(0, 14), 6)),
    ];
    for (const displayName of candidates) {
      const [row] = await this.db
        .insert(profile)
        .values({ userId, displayName, ...avatar })
        .onConflictDoNothing()
        .returning();
      if (row !== undefined) return row;
      const mine = await this.find(userId);
      if (mine !== undefined) return mine;
    }
    throw new Error('no free display name after twelve tries');
  }

  /**
   * The owner's changes. A new name passes the filter and is free (409 `NAME_TAKEN`, 422 `NAME_NOT_ALLOWED`); the
   * picture `provider` needs a sign-in photo (409 `NO_PROVIDER_PHOTO`), a portrait's id shows that portrait.
   */
  async update(userId: string, changes: ProfileChanges): Promise<ProfileView> {
    const current = await this.ensure(userId);
    const image = await this.imageOf(userId);
    const values: Partial<typeof profile.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (changes.avatar === 'provider') {
      if (providerPhoto(image) === null)
        throw new HttpError(HttpStatusCode.CONFLICT, 'NO_PROVIDER_PHOTO');
      values.avatarKind = 'provider';
      values.avatarChosen = true;
    } else if (changes.avatar !== undefined) {
      values.avatarKind = 'portrait';
      values.avatarPortrait = changes.avatar;
      values.avatarChosen = true;
    }
    if (
      changes.displayName !== undefined &&
      changes.displayName !== current.displayName
    ) {
      const problem = displayNameProblem(changes.displayName);
      if (problem === 'format')
        throw new HttpError(HttpStatusCode.BAD_REQUEST, 'NAME_FORMAT');
      if (problem === 'not-allowed')
        throw new HttpError(
          HttpStatusCode.UNPROCESSABLE_ENTITY,
          'NAME_NOT_ALLOWED',
        );
      values.displayName = changes.displayName;
      values.nameChosen = true;
    }
    for (const flag of [
      'publicProfile',
      'allowFriendRequests',
      'showOnline',
      'emailFriendRequests',
    ] as const) {
      const value = changes[flag];
      if (value !== undefined) values[flag] = value;
    }
    try {
      const [row] = await this.db
        .update(profile)
        .set(values)
        .where(eq(profile.userId, userId))
        .returning();
      return toProfileView(row ?? current, image);
    } catch (error) {
      if (isUniqueViolation(error, 'profiles_display_name_key'))
        throw new HttpError(HttpStatusCode.CONFLICT, 'NAME_TAKEN');
      throw error;
    }
  }
}
