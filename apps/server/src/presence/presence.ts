/**
 * Friends' online status (v0.14.4): each signed-in player's last activity is a Redis key that lives
 * `PRESENCE_TTL_SECONDS`, refreshed by their authenticated requests (`MarkPresence`, after `SessionGuard`). A player is
 * online to their friends while the key lives and their profile's `showOnline` is on. Redis is never in a request's
 * way: a mark is not awaited, and with Redis down every player reads as offline and every request still answers.
 */
import { AuthContext } from '@dunx/auth';
import { Logger } from '@dunx/core';
import type { Middleware, Next, RouteContext } from '@dunx/http';
import { RedisConnection } from '@dunx/infra/redis';
import { PRESENCE_TTL_SECONDS } from '@gravoth/contracts';
import type { BunRequest } from 'bun';
import { and, eq, inArray } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { profile } from '../database/schema.js';

/** At most one mark a player per this, per process: the key outlives it four times over. */
export const PRESENCE_REFRESH_MS = 30_000;
/** Past this many players remembered, the ones not marked within the refresh window are forgotten. */
const REMEMBERED_MAX = 10_000;
/** At most one warning a minute about Redis. */
const WARN_EVERY_MS = 60_000;

/** A player's key: the deployment's prefix, as the cache's. */
export const presenceKey = (userId: string): string =>
  `${process.env['DUNX_CACHE_PREFIX'] ?? 'gravoth'}:presence:${userId}`;

/**
 * Where the marks live, and the clock they are kept by. An abstract class so a suite can stand it in (with a clock of
 * its own); `RedisPresenceStore` is the one the app binds.
 */
export abstract class PresenceStore {
  /** The player is active now: their mark lives `seconds` more. Never throws. */
  abstract mark(userId: string, seconds: number): Promise<void>;
  /** The players among `userIds` whose mark lives; no one when the store cannot answer. Never throws. */
  abstract live(userIds: readonly string[]): Promise<ReadonlySet<string>>;
  /** Now, in milliseconds: what the refresh window is measured by. */
  now(): number {
    return Date.now();
  }
}

/** A key per player in Redis (`SET ... EX`, read with one `MGET`): a failed mark is lost, a failed read finds no one. */
export class RedisPresenceStore extends PresenceStore {
  private warned = 0;

  constructor(
    private readonly redis: RedisConnection,
    private readonly logger: Logger,
  ) {
    super();
  }

  async mark(userId: string, seconds: number): Promise<void> {
    try {
      await this.redis.set(presenceKey(userId), '1', { ex: seconds });
    } catch (error) {
      this.warn('presence not marked', error);
    }
  }

  async live(userIds: readonly string[]): Promise<ReadonlySet<string>> {
    const [first, ...rest] = userIds;
    if (first === undefined) return new Set();
    try {
      // Bun raises some connection errors synchronously: inside the try either way.
      const values = await this.redis.mget(
        presenceKey(first),
        ...rest.map(presenceKey),
      );
      return new Set(userIds.filter((_, i) => values[i] != null));
    } catch (error) {
      this.warn('presence not read', error);
      return new Set();
    }
  }

  private warn(message: string, error: unknown): void {
    const now = Date.now();
    if (now - this.warned < WARN_EVERY_MS) return;
    this.warned = now;
    this.logger.warn(`${message}: redis unreachable`, { err: error });
  }
}

/** Marks players active (at most once each per `PRESENCE_REFRESH_MS`) and answers which ones show as online. */
export class Presence {
  /** When each player was last marked by this process. */
  private readonly marked = new Map<string, number>();

  constructor(
    private readonly store: PresenceStore,
    private readonly db: Db,
  ) {}

  /** The player made an authenticated request: their mark is renewed unless it was within the refresh window. */
  seen(userId: string): void {
    const now = this.store.now();
    const last = this.marked.get(userId);
    if (last !== undefined && now - last < PRESENCE_REFRESH_MS) return;
    this.marked.set(userId, now);
    if (this.marked.size > REMEMBERED_MAX)
      for (const [id, at] of this.marked)
        if (now - at >= PRESENCE_REFRESH_MS) this.marked.delete(id);
    void this.store.mark(userId, PRESENCE_TTL_SECONDS);
  }

  /** The players among `userIds` who show as online: marked within the time to live, with `showOnline` on. */
  async online(userIds: readonly string[]): Promise<ReadonlySet<string>> {
    const live = await this.store.live([...new Set(userIds)]);
    if (live.size === 0) return live;
    const shown = await this.db
      .select({ userId: profile.userId })
      .from(profile)
      .where(
        and(inArray(profile.userId, [...live]), eq(profile.showOnline, true)),
      );
    return new Set(shown.map((row) => row.userId));
  }
}

/**
 * After `SessionGuard` (`@UseGuards(SessionGuard, MarkPresence)`): the caller's request marks them active. A public
 * route has no caller and marks no one.
 */
export class MarkPresence implements Middleware {
  constructor(
    private readonly context: AuthContext,
    private readonly presence: Presence,
  ) {}

  handle(_req: BunRequest, _ctx: RouteContext, next: Next): Promise<Response> {
    const caller = this.context.current();
    if (caller !== undefined) this.presence.seen(caller.user.id);
    return next();
  }
}
