import { AuthContext } from '@dunx/auth';
import { HttpError, HttpStatusCode } from '@dunx/http';
import { inArray } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { profile } from '../database/schema.js';

/** The caller, as the social routes need them: an id, and whether it is a guest. */
export interface Caller {
  readonly id: string;
  readonly guest: boolean;
}

/** Who is calling, from the session `SessionGuard` established. */
export const callerOf = (context: AuthContext): Caller => {
  const { user } = context.require();
  return { id: user.id, guest: (user as { isAnonymous?: boolean | null }).isAnonymous === true };
};

/** Friends and blocks need an account a player can get back into: a guest is asked to sign up first. */
export const requireAccount = (context: AuthContext): Caller => {
  const caller = callerOf(context);
  if (caller.guest) throw new HttpError(HttpStatusCode.FORBIDDEN, 'GUEST_ACCOUNT');
  return caller;
};

/** Display names for a set of users, in one query. */
export const displayNames = async (db: Db, userIds: readonly string[]): Promise<Map<string, string>> => {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: profile.userId, displayName: profile.displayName })
    .from(profile)
    .where(inArray(profile.userId, [...new Set(userIds)]));
  return new Map(rows.map((row) => [row.userId, row.displayName]));
};
