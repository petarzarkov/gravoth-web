import { z } from 'zod';
import type { AvatarView } from './avatar.js';

/**
 * Decision 228: chat (decision 226's "friends' direct messages and a global channel", with moderation). Read by polling:
 * no socket, the game asks for what is new while the chat page is open. Every route needs an account that can sign in
 * again (a guest gets 403 `GUEST_ACCOUNT`), and every message is plain text: clients show it without markup.
 */
export const CHAT_LIMITS = {
  /** The longest message, after trimming. */
  MAX_BODY: 300,
  /** Messages a page holds by default, and at most. */
  DEFAULT_TAKE: 50,
  MAX_TAKE: 100,
  /** Messages a player may send in a minute, both channels together (then 429 `TOO_MANY_REQUESTS`). */
  SENDS_PER_MINUTE: 10,
  /** The same text as the sender's last message in that channel, within this many seconds, is refused (`CHAT_REPEAT`). */
  REPEAT_SECONDS: 30,
  /** Days a message is kept (one under an open report stays until the report is closed). */
  KEEP_DAYS: 30,
  /** Distinct players reporting one global message hide it until the developer looks. */
  AUTO_HIDE_REPORTS: 3,
  /** The longest mute, in hours (ten years: for good). */
  MAX_MUTE_HOURS: 87_600,
} as const;

export const CHAT_CHANNELS = ['global', 'direct'] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

export const REPORT_REASONS = [
  'spam',
  'harassment',
  'hate',
  'sexual',
  'cheating',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

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

/** One entry of `GET /api/chat/direct`: a friend, with the conversation's newest message and what is unread. */
export interface ConversationView {
  readonly peer: ChatPlayer;
  /** Null when nothing was written yet. */
  readonly last: ChatMessageView | null;
  readonly unread: number;
}

/** `GET /api/chat/unread`: cheap enough to poll for a badge. */
export interface ChatUnread {
  /** Unread direct messages, all friends together. */
  readonly direct: number;
  /** Per friend with any unread. */
  readonly from: readonly { readonly userId: string; readonly count: number }[];
}

// The moderation routes (`/api/admin/chat`, `@Roles('admin')`), for the website's admin page.

export const REPORT_ACTIONS = ['dismiss', 'hide', 'mute'] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

/** `POST /api/admin/chat/reports/:id/resolve`: `hide` removes the message, `mute` removes it and mutes its writer. */
export const ResolveReport = z
  .object({
    action: z.enum(REPORT_ACTIONS),
    /** For `mute`. */
    hours: z.number().int().min(1).max(CHAT_LIMITS.MAX_MUTE_HOURS).optional(),
    reason: z.string().trim().max(200).optional(),
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

export type ResolveReport = z.infer<typeof ResolveReport>;
export type MutePlayer = z.infer<typeof MutePlayer>;
export type ReportsQuery = z.infer<typeof ReportsQuery>;

export interface ChatReportView {
  readonly id: number;
  readonly reason: ReportReason;
  readonly note: string;
  readonly reporter: ChatPlayer;
  /** The message as it was reported (kept with the report, so it outlives the message's 30 days). */
  readonly message: {
    readonly id: number;
    readonly channel: ChatChannel;
    readonly from: ChatPlayer;
    /** The other player of a direct message. */
    readonly to: ChatPlayer | null;
    readonly body: string;
    readonly at: string;
    /** Removed by moderation (or by the reports' own threshold). */
    readonly hidden: boolean;
  };
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
