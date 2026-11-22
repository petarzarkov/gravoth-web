import { AuthContext } from '@dunx/auth';
import { HttpError, HttpStatusCode } from '@dunx/http';
import { CHAT_LIMITS, type ChatMessageView } from '@gravoth/contracts';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { Db } from '../database/db.js';
import {
  chatMessage,
  friendship,
  profile,
  type ChatMessage,
} from '../database/schema.js';
import { DetailedHttpError } from '../http/detailed-error.js';
import { requireAccount } from '../social/players.js';
import { filterMessage } from './chat-filter.js';
import { activeMute } from './chat.service.js';
import { chatPlayers, messageView, pairOf } from './chat-views.js';

const m = chatMessage;

/** Two messages are "the same text" whatever their case and spacing. */
const sameText = (a: string, b: string): boolean => {
  const plain = (text: string) =>
    text.toLowerCase().replace(/\s+/g, ' ').trim();
  return plain(a) === plain(b);
};

/**
 * Sending (decision 228), in this order: an account (403 `GUEST_ACCOUNT`), the rules accepted (403 `CHAT_RULES`), no
 * mute (403 `CHAT_MUTED` with `until` and `reason`), for a direct message a friend (403 `NOT_FRIENDS`, an unknown player
 * too), the filter (422 `LINKS_NOT_ALLOWED` or `MESSAGE_NOT_ALLOWED`; obscenities are stored masked), then under a lock
 * on the sender: at most `SENDS_PER_MINUTE` in a minute across both channels (429 `TOO_MANY_REQUESTS` with
 * `Retry-After`), and not the text of the sender's last message in that channel within `REPEAT_SECONDS` (409
 * `CHAT_REPEAT`). The count is the sender's own, in the database: the per-route throttle counts an address, which many
 * players can share.
 */
export class ChatSends {
  constructor(
    private readonly db: Db,
    private readonly context: AuthContext,
  ) {}

  async send(peer: string | undefined, raw: string): Promise<ChatMessageView> {
    const me = requireAccount(this.context).id;
    await this.requireAllowed(me);
    if (peer !== undefined) await this.requireFriend(me, peer);
    const filtered = filterMessage(raw);
    if (!filtered.ok) {
      if (filtered.code === 'LINKS_NOT_ALLOWED')
        throw new HttpError(
          HttpStatusCode.UNPROCESSABLE_ENTITY,
          'LINKS_NOT_ALLOWED',
        );
      throw new HttpError(
        HttpStatusCode.UNPROCESSABLE_ENTITY,
        'MESSAGE_NOT_ALLOWED',
      );
    }

    const row = await this.db.transaction(async (tx) => {
      // One send at a time per player, so the count and the repeat check see every message before this one.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`chat:${me}`}, 0))`,
      );
      const now = new Date();
      const [window] = await tx
        .select({ at: m.createdAt })
        .from(m)
        .where(eq(m.senderId, me))
        .orderBy(desc(m.createdAt))
        .limit(1)
        .offset(CHAT_LIMITS.SENDS_PER_MINUTE - 1);
      const opens =
        window === undefined ? 0 : window.at.getTime() + 60_000 - now.getTime();
      if (opens > 0)
        throw new HttpError(
          HttpStatusCode.TOO_MANY_REQUESTS,
          'TOO_MANY_REQUESTS',
          { headers: { 'retry-after': String(Math.ceil(opens / 1000)) } },
        );

      const [last] = await tx
        .select({ body: m.body, at: m.createdAt })
        .from(m)
        .where(
          and(
            eq(m.senderId, me),
            peer === undefined ? eq(m.channel, 'global') : pairOf(me, peer),
          ),
        )
        .orderBy(desc(m.id))
        .limit(1);
      if (
        last !== undefined &&
        now.getTime() - last.at.getTime() < CHAT_LIMITS.REPEAT_SECONDS * 1000 &&
        sameText(last.body, filtered.body)
      )
        throw new HttpError(HttpStatusCode.CONFLICT, 'CHAT_REPEAT');

      const [inserted] = await tx
        .insert(m)
        .values({
          channel: peer === undefined ? 'global' : 'direct',
          senderId: me,
          recipientId: peer ?? null,
          body: filtered.body,
          createdAt: now,
        })
        .returning();
      return inserted;
    });
    if (row === undefined) throw new Error('chat message not stored');
    return this.view(row, me);
  }

  private async view(row: ChatMessage, me: string): Promise<ChatMessageView> {
    return messageView(row, me, await chatPlayers(this.db, [me]));
  }

  /** The rules accepted, and no mute in force. */
  private async requireAllowed(me: string): Promise<void> {
    const [rules] = await this.db
      .select({ at: profile.chatRulesAt })
      .from(profile)
      .where(eq(profile.userId, me))
      .limit(1);
    if (rules?.at === null || rules?.at === undefined)
      throw new HttpError(HttpStatusCode.FORBIDDEN, 'CHAT_RULES');
    const mute = await activeMute(this.db, me);
    if (mute !== null)
      throw new DetailedHttpError(HttpStatusCode.FORBIDDEN, 'CHAT_MUTED', {
        until: mute.until,
        reason: mute.reason,
      });
  }

  /** Direct messages go to accepted friends only: blocking ends the friendship, so a block stops them too. */
  private async requireFriend(me: string, peer: string): Promise<void> {
    const [row] =
      peer === me
        ? []
        : await this.db
            .select({ id: friendship.id })
            .from(friendship)
            .where(
              and(
                eq(friendship.status, 'accepted'),
                or(
                  and(
                    eq(friendship.requesterId, me),
                    eq(friendship.addresseeId, peer),
                  ),
                  and(
                    eq(friendship.requesterId, peer),
                    eq(friendship.addresseeId, me),
                  ),
                ),
              ),
            )
            .limit(1);
    if (row === undefined)
      throw new HttpError(HttpStatusCode.FORBIDDEN, 'NOT_FRIENDS');
  }
}
