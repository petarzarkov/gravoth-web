import { z } from 'zod';
import type { AvatarView } from './avatar.js';
import {
  CHAT_LIMITS,
  REPORT_ACTIONS,
  REPORT_REASONS,
  type ChatChannel,
  type ReportAction,
  type ReportReason,
} from './constants.js';

/**
 * Decision 228: chat (decision 226's "friends' direct messages and a global channel", with moderation). Read by polling:
 * no socket, the game asks for what is new while the chat page is open. Every route needs an account that can sign in
 * again (a guest gets 403 `GUEST_ACCOUNT`), and every message is plain text: clients show it without markup.
 *
 * The plain facts (`CHAT_LIMITS`, `CHAT_CHANNELS`, `REPORT_REASONS`, `REPORT_ACTIONS`) are in constants.ts, so the
 * website's admin page reads them without zod.
 */

/** `POST /api/chat/global` and `POST /api/chat/direct/:userId`. */
export const SendMessage = z
  .object({ body: z.string().trim().min(1).max(CHAT_LIMITS.MAX_BODY) })
  .meta({
    id: 'SendMessage',
    description:
      'A chat message: plain text, 1 to 300 characters after trimming',
  });

/**
 * A channel's messages, oldest first in the answer. Neither `after` nor `before`: the newest `take`. `after`: the ones
 * newer than that id (the poll; when more than `take` are newer, the newest `take` and `gap: true`). `before`: the
 * `take` before that id (scrolling back).
 */
export const ChatQuery = z.object({
  after: z.coerce.number().int().min(0).optional(),
  before: z.coerce.number().int().min(1).optional(),
  take: z.coerce
    .number()
    .int()
    .min(1)
    .max(CHAT_LIMITS.MAX_TAKE)
    .default(CHAT_LIMITS.DEFAULT_TAKE),
});

export const MessageId = z.object({ id: z.coerce.number().int().min(1) });

/** `POST /api/chat/direct/:userId/read`: every message from that player up to this id is read. */
export const MarkRead = z.object({ upTo: z.number().int().min(0) });

/** `POST /api/chat/messages/:id/report`. */
export const ReportMessage = z
  .object({
    reason: z.enum(REPORT_REASONS),
    note: z.string().trim().max(200).optional(),
  })
  .meta({
    id: 'ReportMessage',
    description: 'Why a message is reported, with an optional note',
  });

export type SendMessage = z.infer<typeof SendMessage>;
export type ChatQuery = z.infer<typeof ChatQuery>;
export type MarkRead = z.infer<typeof MarkRead>;
export type ReportMessage = z.infer<typeof ReportMessage>;

/** Who wrote a message, or the other player of a conversation. */
export interface ChatPlayer {
  readonly userId: string;
  readonly displayName: string;
  readonly avatar: AvatarView;
}

export interface ChatMessageView {
  /** Ascending in the order messages were sent, across both channels. */
  readonly id: number;
  readonly channel: ChatChannel;
  readonly from: ChatPlayer;
  /** Plain text, as stored after the word filter (masked words come back as `*`). */
  readonly body: string;
  /** ISO time. */
  readonly at: string;
  /** The caller wrote it. */
  readonly mine: boolean;
}

export interface ChatMute {
  /** ISO time the mute ends. */
  readonly until: string;
  readonly reason: string;
}

/** `GET /api/chat/global` and `GET /api/chat/direct/:userId`. */
export interface ChatPage {
  readonly messages: readonly ChatMessageView[];
  /** Newer messages were skipped (an `after` poll with more than `take` new ones). */
  readonly gap: boolean;
  /** Ids removed by moderation in the last day, so an open chat drops them. */
  readonly removed: readonly number[];
  /** The caller's mute, or null. */
  readonly muted: ChatMute | null;
  /** False until the caller accepts the chat rules (`POST /api/chat/rules/accept`); sending is refused before. */
  readonly rulesAccepted: boolean;
}

/**
 * One entry of `GET /api/chat/direct`: a player the caller has written with (a friend, or a friend once: the history
 * stays readable to both), with the conversation's newest message and what is unread. A player the caller blocked is
 * left out.
 */
export interface ConversationView {
  readonly peer: ChatPlayer;
  /** Null when moderation removed every message of it. */
  readonly last: ChatMessageView | null;
  readonly unread: number;
}

/** `GET /api/chat/direct`: the newest conversation first. */
export interface ChatConversations {
  readonly conversations: readonly ConversationView[];
}

/** `GET /api/chat/unread`: cheap enough to poll for a badge. */
export interface ChatUnread {
  /** Unread direct messages, all friends together. */
  readonly direct: number;
  /** Per friend with any unread. */
  readonly from: readonly { readonly userId: string; readonly count: number }[];
}

// The moderation routes (`/api/admin/chat`, `@Roles('admin')`), for the website's admin page.

/**
 * `POST /api/admin/chat/reports/:id/resolve`: `dismiss` closes it (and shows again a message the reports' own threshold
 * hid), `hide` removes the message, `mute` removes it and mutes its writer for `hours` (required). Every open report of
 * the same message closes with it.
 */
export const ResolveReport = z
  .object({
    action: z.enum(REPORT_ACTIONS),
    /** For `mute`, where it is required. */
    hours: z.number().int().min(1).max(CHAT_LIMITS.MAX_MUTE_HOURS).optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((value) => value.action !== 'mute' || value.hours !== undefined, {
    message: 'a mute needs its hours',
    path: ['hours'],
  })
  .meta({ id: 'ResolveReport', description: "A report's outcome" });

/** `POST /api/admin/chat/mutes`. */
export const MutePlayer = z
  .object({
    userId: z.uuid(),
    hours: z.number().int().min(1).max(CHAT_LIMITS.MAX_MUTE_HOURS),
    reason: z.string().trim().max(200).default(''),
  })
  .meta({
    id: 'MutePlayer',
    description: 'Mute a player in every channel for a while',
  });

export const ReportsQuery = z.object({
  state: z.enum(['open', 'closed']).default('open'),
  take: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().min(1).optional(),
});

/**
 * `GET /api/admin/chat/messages`, hidden ones too, oldest first in the answer. No `userId`: the global channel. A
 * `userId`: that player's own messages in both channels. With `peerId` as well: the direct conversation of the two.
 * `around`: the messages either side of that id (half of `take` each way, the id among them); else `before` as in
 * `ChatQuery`, or the newest.
 */
export const AdminChatQuery = z.object({
  userId: z.uuid().optional(),
  peerId: z.uuid().optional(),
  around: z.coerce.number().int().min(1).optional(),
  before: z.coerce.number().int().min(1).optional(),
  take: z.coerce
    .number()
    .int()
    .min(1)
    .max(CHAT_LIMITS.MAX_TAKE)
    .default(CHAT_LIMITS.DEFAULT_TAKE),
});

export type ResolveReport = z.infer<typeof ResolveReport>;
export type MutePlayer = z.infer<typeof MutePlayer>;
export type ReportsQuery = z.infer<typeof ReportsQuery>;
export type AdminChatQuery = z.infer<typeof AdminChatQuery>;

/** A message as moderation sees it: either channel, hidden or not, with the other player of a direct message. */
export interface ChatModeratedMessage {
  readonly id: number;
  readonly channel: ChatChannel;
  readonly from: ChatPlayer;
  /** The other player of a direct message. */
  readonly to: ChatPlayer | null;
  readonly body: string;
  readonly at: string;
  /** Removed by moderation (or by the reports' own threshold). */
  readonly hidden: boolean;
}

export interface ChatReportView {
  readonly id: number;
  readonly reason: ReportReason;
  readonly note: string;
  readonly reporter: ChatPlayer;
  /** The message as it was reported (kept with the report, so it outlives the message's 30 days). */
  readonly message: ChatModeratedMessage;
  /** Distinct players who reported this message. */
  readonly reports: number;
  readonly createdAt: string;
  /** Null while open. */
  readonly resolved: {
    readonly action: ReportAction;
    readonly at: string;
    readonly by: string;
  } | null;
}

export interface ChatMuteView extends ChatMute {
  readonly player: ChatPlayer;
  readonly createdAt: string;
}

/** `GET /api/admin/chat/reports`: newest first; the next page is `before` the last one's id. */
export interface ChatReportList {
  readonly reports: readonly ChatReportView[];
}

/** `GET /api/admin/chat/mutes`: the mutes in force, newest first. */
export interface ChatMuteList {
  readonly mutes: readonly ChatMuteView[];
}

/** `GET /api/admin/chat/messages`. */
export interface ChatModeratedMessages {
  readonly messages: readonly ChatModeratedMessage[];
}
