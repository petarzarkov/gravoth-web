import { AuthContext } from '@dunx/auth';
import { HttpError, HttpStatusCode } from '@dunx/http';
import { Cache } from '@dunx/infra/cache';
import {
  HARDCORE_PREFIX,
  SUGGESTION_LIMITS,
  type SuggestionList,
  type SuggestionReason,
  type SuggestionView,
} from '@gravoth/contracts';
import { eq, sql, type SQL } from 'drizzle-orm';
import { shownEntry } from '../boards/shown.js';
import { AppConfigService } from '../config.js';
import { Db } from '../database/db.js';
import { isForeignKeyViolation } from '../database/errors.js';
import { suggestionDismissal, user } from '../database/schema.js';
import { avatarView } from '../players/avatars.js';
import { requireAccount } from './players.js';
export type { SuggestionList, SuggestionReason, SuggestionView };

const DAY_MS = 86_400_000;

/** How long a caller's list is kept: the friend, request, block and dismiss routes drop it sooner (`SuggestionCache`). */
export const SUGGESTION_CACHE_MS = 5 * 60_000;

/**
 * A caller's computed list in the app's two-tier `Cache`, for `SUGGESTION_CACHE_MS`. Friends and Blocks drop both
 * players' lists when they change what either may be suggested, and a dismissal the caller's, so a request, an answer,
 * a removal, a block or a dismissal shows at once; anything else (another player's privacy settings, a deleted
 * account) is caught when the list is read (`Suggestions.list`).
 */
export class SuggestionCache {
  constructor(private readonly cache: Cache) {}

  wrap(
    userId: string,
    load: () => Promise<SuggestionView[]>,
  ): Promise<SuggestionView[]> {
    return this.cache.wrap(keyOf(userId), load, SUGGESTION_CACHE_MS);
  }

  async drop(...userIds: readonly string[]): Promise<void> {
    await Promise.all(userIds.map((id) => this.cache.del(keyOf(id))));
  }
}

const keyOf = (userId: string) => `suggestions:${userId}`;

/** One phrase a reason reads as, short and plain for the game's UI. */
const phrase = (reason: SuggestionReason): string => {
  switch (reason.kind) {
    case 'mutual':
      return reason.count === 1
        ? '1 mutual friend'
        : `${reason.count} mutual friends`;
    case 'board':
      return `Near you on ${reason.boardTitle}`;
    case 'chat':
      return 'Chatted with you in Global';
    case 'active':
      return 'Played this week';
  }
};

/** The line a client shows as it is: the two strongest reasons, joined with " · ". */
export const noteOf = (reasons: readonly SuggestionReason[]): string =>
  reasons.slice(0, 2).map(phrase).join(' · ');

/**
 * Whom a caller may be suggested, as SQL over `profiles` and `users` (unaliased) for the candidate `candidate`: never
 * the caller, a guest, a banned account, a hidden profile or one closed to requests; never a friend or anyone with a
 * request either way (one `friendships` row per pair, found by its unique index's own expressions); never a block
 * either way; never a player the caller dismissed in the last `DISMISS_DAYS` days.
 */
const suggestible = (me: string, candidate: SQL, now: Date): SQL => {
  const dismissedSince = new Date(
    now.getTime() - SUGGESTION_LIMITS.DISMISS_DAYS * DAY_MS,
  );
  return sql`${candidate} <> ${me}::uuid
    AND profiles.public_profile AND profiles.allow_friend_requests
    AND users.is_anonymous IS NOT TRUE
    AND (users.banned IS NOT TRUE OR users.ban_expires <= ${now}::timestamptz)
    AND NOT EXISTS (SELECT 1 FROM friendships f
      WHERE least(f.requester_id, f.addressee_id) = least(${me}::uuid, ${candidate})
        AND greatest(f.requester_id, f.addressee_id) = greatest(${me}::uuid, ${candidate}))
    AND NOT EXISTS (SELECT 1 FROM blocks b
      WHERE (b.blocker_id = ${me}::uuid AND b.blocked_id = ${candidate})
         OR (b.blocker_id = ${candidate} AND b.blocked_id = ${me}::uuid))
    AND NOT EXISTS (SELECT 1 FROM suggestion_dismissals d
      WHERE d.user_id = ${me}::uuid AND d.dismissed_id = ${candidate}
        AND d.dismissed_at > ${dismissedSince}::timestamptz)`;
};

/** A row of the list's query: the player, and what each source found (null where it found nothing). */
interface Row {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarKind: 'provider' | 'portrait';
  readonly avatarPortrait: string;
  readonly image: string | null;
  readonly mutual: number | null;
  readonly boardKey: string | null;
  readonly boardHardcore: boolean | null;
  readonly boardTitle: string | null;
  readonly yourRank: number | null;
  readonly theirRank: number | null;
  readonly chattedAt: Date | null;
}

/** The reasons, strongest first: the order the list ranks by. `active` only for a player no other source found. */
const reasonsOf = (row: Row): SuggestionReason[] => {
  const reasons: SuggestionReason[] = [];
  if (row.mutual !== null) reasons.push({ kind: 'mutual', count: row.mutual });
  if (row.boardKey !== null)
    reasons.push({
      kind: 'board',
      boardId: `${row.boardHardcore === true ? HARDCORE_PREFIX : ''}${row.boardKey}`,
      boardTitle: row.boardTitle ?? '',
      yourRank: row.yourRank ?? 0,
      theirRank: row.theirRank ?? 0,
    });
  if (row.chattedAt !== null) reasons.push({ kind: 'chat' });
  if (reasons.length === 0) reasons.push({ kind: 'active' });
  return reasons;
};

/**
 * Friend suggestions (decision 229), for an account that can sign in again (a guest gets 403 `GUEST_ACCOUNT`, as the
 * other friends routes give). Four sources, in one query:
 *
 * 1. **mutual**: friends of the caller's friends; the count is how many of the caller's friends they share.
 * 2. **board**: on each board the caller has a shown record on (`boards/shown.ts`, so online heroes only while
 *    BOARDS_ONLINE_ONLY is on), the players ranked within `BOARD_PLACES` places of the caller's best, ranked as the
 *    boards rank (score, then the earlier time, then the row id); the closest board per player is kept.
 * 3. **chat**: the authors of global messages within `CHAT_MINUTES` of one of the caller's own in the last
 *    `RECENT_DAYS` days, hidden ones left out on both sides.
 * 4. **active**: players whose session was used in the last `RECENT_DAYS` days (the use the guest clean-up reads: the
 *    website renews a session daily, and `GET /api/account`, which the game calls at every launch, marks a game
 *    session used), only to fill the places the others leave.
 *
 * The scoring is an order, not a sum: the number of sources among the first three that found the player (more first),
 * then mutual friends (more first), then the board distance (closer first), then the latest shared chat (newer first),
 * then, for the fill, the latest use (newer first), then the display name and the id, so the order is total. Every
 * player is checked by `suggestible` before it ranks, and again when a cached list is read.
 */
export class Suggestions {
  constructor(
    private readonly db: Db,
    private readonly context: AuthContext,
    private readonly cache: SuggestionCache,
    private readonly config: AppConfigService,
  ) {}

  /** At most `SUGGESTION_LIMITS.MAX`, the best first. */
  async list(): Promise<SuggestionList> {
    const me = requireAccount(this.context).id;
    const computed = await this.cache.wrap(me, () => this.compute(me));
    return { items: await this.stillSuggestible(me, computed) };
  }

  /**
   * Hides a player from the caller's suggestions for `DISMISS_DAYS` days (again starts the days over). 404
   * `PLAYER_NOT_FOUND` for no such account, a guest, or the caller.
   */
  async dismiss(userId: string): Promise<void> {
    const me = requireAccount(this.context).id;
    const notFound = () =>
      new HttpError(HttpStatusCode.NOT_FOUND, 'PLAYER_NOT_FOUND');
    if (userId === me) throw notFound();
    const [target] = await this.db
      .select({ guest: user.isAnonymous })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (target === undefined || target.guest === true) throw notFound();
    try {
      await this.db
        .insert(suggestionDismissal)
        .values({ userId: me, dismissedId: userId, dismissedAt: new Date() })
        .onConflictDoUpdate({
          target: [suggestionDismissal.userId, suggestionDismissal.dismissedId],
          set: { dismissedAt: sql`excluded.dismissed_at` },
        });
    } catch (error) {
      // The account went between the read and the write.
      if (isForeignKeyViolation(error)) throw notFound();
      throw error;
    }
    await this.cache.drop(me);
  }

  /** The caller's list as of `now`, uncached. */
  async compute(me: string, now = new Date()): Promise<SuggestionView[]> {
    const shown = shownEntry(this.config.get('boards').onlineOnly);
    const since = new Date(
      now.getTime() - SUGGESTION_LIMITS.RECENT_DAYS * DAY_MS,
    );
    const window = sql`(${SUGGESTION_LIMITS.CHAT_MINUTES}::int * interval '1 minute')`;
    const rows = (await this.db.execute(sql`
      WITH
      my_friends AS (
        SELECT addressee_id AS id FROM friendships WHERE requester_id = ${me}::uuid AND status = 'accepted'
        UNION
        SELECT requester_id FROM friendships WHERE addressee_id = ${me}::uuid AND status = 'accepted'
      ),
      mutual AS (
        SELECT pair.id AS user_id, count(DISTINCT pair.via)::int AS n
        FROM (
          SELECT f.addressee_id AS id, f.requester_id AS via
            FROM friendships f JOIN my_friends m ON m.id = f.requester_id
            WHERE f.status = 'accepted'
          UNION ALL
          SELECT f.requester_id, f.addressee_id
            FROM friendships f JOIN my_friends m ON m.id = f.addressee_id
            WHERE f.status = 'accepted'
        ) pair
        GROUP BY pair.id
      ),
      my_boards AS (
        SELECT DISTINCT leaderboard_entries.board_id
        FROM leaderboard_entries JOIN heroes ON heroes.id = leaderboard_entries.hero_id
        WHERE leaderboard_entries.user_id = ${me}::uuid AND ${shown}
      ),
      ranked AS (
        SELECT leaderboard_entries.board_id, leaderboard_entries.user_id,
          row_number() OVER (
            PARTITION BY leaderboard_entries.board_id
            ORDER BY CASE WHEN leaderboards.sort = 'desc' THEN -leaderboard_entries.score ELSE leaderboard_entries.score END,
              leaderboard_entries.achieved_at, leaderboard_entries.id
          )::int AS rank
        FROM leaderboard_entries
        JOIN heroes ON heroes.id = leaderboard_entries.hero_id
        JOIN leaderboards ON leaderboards.id = leaderboard_entries.board_id
        WHERE leaderboard_entries.board_id IN (SELECT board_id FROM my_boards) AND ${shown}
      ),
      my_places AS (
        SELECT board_id, min(rank) AS rank FROM ranked WHERE user_id = ${me}::uuid GROUP BY board_id
      ),
      near AS (
        SELECT DISTINCT ON (r.user_id)
          r.user_id, r.board_id, mp.rank AS your_rank, r.rank AS their_rank, abs(r.rank - mp.rank) AS distance
        FROM ranked r JOIN my_places mp ON mp.board_id = r.board_id
        WHERE r.user_id <> ${me}::uuid AND abs(r.rank - mp.rank) <= ${SUGGESTION_LIMITS.BOARD_PLACES}::int
        ORDER BY r.user_id, abs(r.rank - mp.rank), r.board_id, r.rank
      ),
      chatted AS (
        SELECT theirs.sender_id AS user_id, max(theirs.created_at) AS at
        FROM chat_messages mine
        JOIN chat_messages theirs
          ON theirs.channel = 'global' AND theirs.hidden_at IS NULL AND theirs.sender_id <> mine.sender_id
          AND theirs.created_at BETWEEN mine.created_at - ${window} AND mine.created_at + ${window}
        WHERE mine.sender_id = ${me}::uuid AND mine.channel = 'global' AND mine.hidden_at IS NULL
          AND mine.created_at >= ${since}::timestamptz
        GROUP BY theirs.sender_id
      ),
      found AS (
        SELECT user_id FROM mutual UNION SELECT user_id FROM near UNION SELECT user_id FROM chatted
      ),
      active AS (
        SELECT user_id, max(updated_at) AS at FROM sessions
        WHERE updated_at >= ${since}::timestamptz AND user_id NOT IN (SELECT user_id FROM found)
        GROUP BY user_id
      ),
      pool AS (
        SELECT user_id FROM found UNION ALL SELECT user_id FROM active
      )
      SELECT pool.user_id AS "userId", profiles.display_name AS "displayName",
        profiles.avatar_kind AS "avatarKind", profiles.avatar_portrait AS "avatarPortrait", users.image,
        mutual.n AS mutual,
        board.key AS "boardKey", board.hardcore AS "boardHardcore", board.title AS "boardTitle",
        near.your_rank AS "yourRank", near.their_rank AS "theirRank",
        chatted.at AS "chattedAt"
      FROM pool
      JOIN profiles ON profiles.user_id = pool.user_id
      JOIN users ON users.id = pool.user_id
      LEFT JOIN mutual ON mutual.user_id = pool.user_id
      LEFT JOIN near ON near.user_id = pool.user_id
      LEFT JOIN leaderboards board ON board.id = near.board_id
      LEFT JOIN chatted ON chatted.user_id = pool.user_id
      LEFT JOIN active ON active.user_id = pool.user_id
      WHERE ${suggestible(me, sql`pool.user_id`, now)}
      ORDER BY
        (mutual.n IS NOT NULL)::int + (near.user_id IS NOT NULL)::int + (chatted.user_id IS NOT NULL)::int DESC,
        mutual.n DESC NULLS LAST,
        near.distance ASC NULLS LAST,
        chatted.at DESC NULLS LAST,
        active.at DESC NULLS LAST,
        lower(profiles.display_name), pool.user_id
      LIMIT ${SUGGESTION_LIMITS.MAX}::int
    `)) as unknown as Row[];
    return rows.map((row) => {
      const reasons = reasonsOf(row);
      return {
        userId: row.userId,
        displayName: row.displayName,
        avatar: avatarView(row, row.image),
        reasons,
        note: noteOf(reasons),
      };
    });
  }

  /** A cached list without anyone who may no longer be suggested (one query by the ids). */
  private async stillSuggestible(
    me: string,
    items: readonly SuggestionView[],
  ): Promise<SuggestionView[]> {
    if (items.length === 0) return [];
    const ids = sql.join(
      items.map((item) => sql`${item.userId}::uuid`),
      sql`, `,
    );
    const rows = (await this.db.execute(sql`
      SELECT profiles.user_id AS "userId"
      FROM profiles JOIN users ON users.id = profiles.user_id
      WHERE profiles.user_id IN (${ids}) AND ${suggestible(me, sql`profiles.user_id`, new Date())}
    `)) as unknown as { userId: string }[];
    const keep = new Set(rows.map((row) => row.userId));
    return items.filter((item) => keep.has(item.userId));
  }
}
