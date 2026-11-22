import { AuthContext } from '@dunx/auth';
import { HttpError, HttpStatusCode } from '@dunx/http';
import type { AvatarView } from '@gravoth/contracts';
import { eq, inArray } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { profile, user } from '../database/schema.js';
import { avatarView } from '../players/avatars.js';

/** The caller, as the social routes need them: an id, and whether it is a guest. */
export interface Caller {
  readonly id: string;
  readonly guest: boolean;
}

/** Who is calling, from the session `SessionGuard` established. */
export const callerOf = (context: AuthContext): Caller => {
  const { user } = context.require();
  return {
    id: user.id,
    guest: (user as { isAnonymous?: boolean | null }).isAnonymous === true,
  };
};

/** Friends and blocks need an account a player can get back into: a guest is asked to sign up first. */
export const requireAccount = (context: AuthContext): Caller => {
  const caller = callerOf(context);
  if (caller.guest)
    throw new HttpError(HttpStatusCode.FORBIDDEN, 'GUEST_ACCOUNT');
  return caller;
};

/** Display names for a set of users, in one query. */
export const displayNames = async (
  db: Db,
  userIds: readonly string[],
): Promise<Map<string, string>> => {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: profile.userId, displayName: profile.displayName })
    .from(profile)
    .where(inArray(profile.userId, [...new Set(userIds)]));
  return new Map(rows.map((row) => [row.userId, row.displayName]));
};

/** A player as a friends list shows them: the name and the picture. */
export interface PlayerCard {
  readonly displayName: string;
  readonly avatar: AvatarView;
}

/** Display names and pictures for a set of users, in one query. */
export const playerCards = async (
  db: Db,
  userIds: readonly string[],
): Promise<Map<string, PlayerCard>> => {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({
      userId: profile.userId,
      displayName: profile.displayName,
      avatarKind: profile.avatarKind,
      avatarPortrait: profile.avatarPortrait,
      image: user.image,
    })
    .from(profile)
    .innerJoin(user, eq(user.id, profile.userId))
    .where(inArray(profile.userId, [...new Set(userIds)]));
  return new Map(
    rows.map((row) => [
      row.userId,
      { displayName: row.displayName, avatar: avatarView(row, row.image) },
    ]),
  );
};

/** A player whose profile is gone (a crash between the user and its profile): no name, the first portrait. */
export const NO_CARD: PlayerCard = {
  displayName: '',
  avatar: { kind: 'portrait', portrait: 'warden', url: null },
};
