import { AuthContext } from '@dunx/auth';
import { HttpError, HttpStatusCode } from '@dunx/http';
import { paginate, type Page } from '@dunx/infra/pagination';
import { and, eq, or } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { isUniqueViolation } from '../database/errors.js';
import { block, friendship, user, type Friendship } from '../database/schema.js';
import { mapPage, type PageQuery } from '../http/page-query.js';
import { Mailer } from '../mail/mailer.js';
import { Profiles } from '../players/profiles.service.js';
import { displayNames, requireAccount, type Caller } from './players.js';

export interface FriendView {
  readonly userId: string;
  readonly displayName: string;
  /** When the request was accepted. */
  readonly since: string;
}

export interface RequestView {
  readonly id: string;
  /** The other player. */
  readonly userId: string;
  readonly displayName: string;
  readonly direction: 'incoming' | 'outgoing';
  readonly createdAt: string;
}

export type RequestOutcome =
  | { readonly status: 'pending'; readonly request: RequestView }
  /** They had already asked the caller, so asking back accepts theirs. */
  | { readonly status: 'accepted'; readonly friend: FriendView };

/** The row of a pair, whichever of the two asked. */
const pairOf = (a: string, b: string) =>
  or(and(eq(friendship.requesterId, a), eq(friendship.addresseeId, b)), and(eq(friendship.requesterId, b), eq(friendship.addresseeId, a)));

/**
 * Friend requests and friendships (docs/online-plan.md, step 6's first half): one row per pair (friendships), pending
 * until the addressee accepts; declining or cancelling deletes it. Requests go to a display name. A player who blocked
 * the caller looks like no player at all; a player the caller blocked must be unblocked first; a profile can close
 * itself to requests. Guests have no friends (a guest has no way back into its account).
 */
export class Friends {
  constructor(
    private readonly db: Db,
    private readonly context: AuthContext,
    private readonly profiles: Profiles,
    private readonly mail: Mailer,
  ) {}

  async request(displayName: string): Promise<RequestOutcome> {
    const me = requireAccount(this.context);
    const target = await this.profiles.findByName(displayName);
    if (target === undefined) throw new HttpError(HttpStatusCode.NOT_FOUND, 'PLAYER_NOT_FOUND');
    if (target.userId === me.id) throw new HttpError(HttpStatusCode.BAD_REQUEST, 'CANNOT_FRIEND_SELF');
    const [targetUser] = await this.db
      .select({ guest: user.isAnonymous, email: user.email, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.id, target.userId))
      .limit(1);
    if (targetUser === undefined || targetUser.guest === true) throw new HttpError(HttpStatusCode.NOT_FOUND, 'PLAYER_NOT_FOUND');

    const blocks = await this.db
      .select({ blockerId: block.blockerId })
      .from(block)
      .where(
        or(and(eq(block.blockerId, target.userId), eq(block.blockedId, me.id)), and(eq(block.blockerId, me.id), eq(block.blockedId, target.userId))),
      );
    if (blocks.some((row) => row.blockerId === target.userId)) throw new HttpError(HttpStatusCode.NOT_FOUND, 'PLAYER_NOT_FOUND');
    if (blocks.length > 0) throw new HttpError(HttpStatusCode.CONFLICT, 'PLAYER_BLOCKED');

    const existing = await this.pair(me.id, target.userId);
    if (existing !== undefined) return this.answerExisting(me, existing);
    if (!target.allowFriendRequests) throw new HttpError(HttpStatusCode.FORBIDDEN, 'REQUESTS_CLOSED');

    let row: Friendship | undefined;
    try {
      [row] = await this.db.insert(friendship).values({ requesterId: me.id, addresseeId: target.userId }).returning();
    } catch (error) {
      // Both asked at once: the pair's unique index let one row in. Answer as if this request came second.
      if (!isUniqueViolation(error, 'friendships_pair_key')) throw error;
      const raced = await this.pair(me.id, target.userId);
      if (raced === undefined) throw error;
      return this.answerExisting(me, raced);
    }
    if (row === undefined) throw new Error('friend request not stored');

    if (targetUser.emailVerified && target.emailFriendRequests) {
      const from = (await this.profiles.ensure(me.id)).displayName;
      await this.mail.friendRequest(targetUser.email, target.displayName, from);
    }
    return { status: 'pending', request: this.requestView(row, me.id, target.displayName) };
  }

  async accept(requestId: string): Promise<FriendView> {
    const me = requireAccount(this.context);
    const [row] = await this.db
      .update(friendship)
      .set({ status: 'accepted', respondedAt: new Date() })
      .where(and(eq(friendship.id, requestId), eq(friendship.addresseeId, me.id), eq(friendship.status, 'pending')))
      .returning();
    if (row === undefined) throw new HttpError(HttpStatusCode.NOT_FOUND, 'REQUEST_NOT_FOUND');
    return this.friendView(row, me.id, (await displayNames(this.db, [row.requesterId])).get(row.requesterId) ?? '');
  }

  async decline(requestId: string): Promise<void> {
    const me = requireAccount(this.context);
    await this.deletePending(and(eq(friendship.id, requestId), eq(friendship.addresseeId, me.id)));
  }

  async cancel(requestId: string): Promise<void> {
    const me = requireAccount(this.context);
    await this.deletePending(and(eq(friendship.id, requestId), eq(friendship.requesterId, me.id)));
  }

  async remove(friendId: string): Promise<void> {
    const me = requireAccount(this.context);
    const gone = await this.db
      .delete(friendship)
      .where(and(pairOf(me.id, friendId), eq(friendship.status, 'accepted')))
      .returning({ id: friendship.id });
    if (gone.length === 0) throw new HttpError(HttpStatusCode.NOT_FOUND, 'FRIEND_NOT_FOUND');
  }

  /** The caller's friends, newest friendship first. */
  async list(page: PageQuery): Promise<Page<FriendView>> {
    const me = requireAccount(this.context);
    const rows = await paginate<typeof friendship, Friendship>({
      db: this.db,
      table: friendship,
      options: { ...page, order: 'desc' },
      where: and(eq(friendship.status, 'accepted'), or(eq(friendship.requesterId, me.id), eq(friendship.addresseeId, me.id))),
      orderBy: 'respondedAt',
    });
    return mapPage(rows, async (data) => {
      const names = await displayNames(this.db, data.map((row) => this.other(row, me.id)));
      return data.map((row) => this.friendView(row, me.id, names.get(this.other(row, me.id)) ?? ''));
    });
  }

  /** Requests waiting on the caller (`incoming`) or sent by the caller (`outgoing`), newest first. */
  async requests(direction: 'incoming' | 'outgoing', page: PageQuery): Promise<Page<RequestView>> {
    const me = requireAccount(this.context);
    const rows = await paginate<typeof friendship, Friendship>({
      db: this.db,
      table: friendship,
      options: { ...page, order: 'desc' },
      where: and(eq(friendship.status, 'pending'), eq(direction === 'incoming' ? friendship.addresseeId : friendship.requesterId, me.id)),
      orderBy: 'createdAt',
    });
    return mapPage(rows, async (data) => {
      const names = await displayNames(this.db, data.map((row) => this.other(row, me.id)));
      return data.map((row) => this.requestView(row, me.id, names.get(this.other(row, me.id)) ?? ''));
    });
  }

  private async pair(a: string, b: string): Promise<Friendship | undefined> {
    const [row] = await this.db.select().from(friendship).where(pairOf(a, b)).limit(1);
    return row;
  }

  private async answerExisting(me: Caller, row: Friendship): Promise<RequestOutcome> {
    if (row.status === 'accepted') throw new HttpError(HttpStatusCode.CONFLICT, 'ALREADY_FRIENDS');
    if (row.requesterId === me.id) throw new HttpError(HttpStatusCode.CONFLICT, 'ALREADY_REQUESTED');
    return { status: 'accepted', friend: await this.accept(row.id) };
  }

  private async deletePending(where: ReturnType<typeof and>): Promise<void> {
    const gone = await this.db
      .delete(friendship)
      .where(and(where, eq(friendship.status, 'pending')))
      .returning({ id: friendship.id });
    if (gone.length === 0) throw new HttpError(HttpStatusCode.NOT_FOUND, 'REQUEST_NOT_FOUND');
  }

  private other(row: Friendship, me: string): string {
    return row.requesterId === me ? row.addresseeId : row.requesterId;
  }

  private friendView(row: Friendship, me: string, displayName: string): FriendView {
    return { userId: this.other(row, me), displayName, since: (row.respondedAt ?? row.createdAt).toISOString() };
  }

  private requestView(row: Friendship, me: string, displayName: string): RequestView {
    return {
      id: row.id,
      userId: this.other(row, me),
      displayName,
      direction: row.addresseeId === me ? 'incoming' : 'outgoing',
      createdAt: row.createdAt.toISOString(),
    };
  }
}
