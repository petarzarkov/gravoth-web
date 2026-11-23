import { SessionGuard } from '@dunx/auth';
import {
  Controller,
  Get,
  HttpStatusCode,
  Post,
  Roles,
  Throttle,
  UseGuards,
  type Input,
} from '@dunx/http';
import {
  AdminChatQuery,
  ChatQuery,
  MarkRead,
  MessageId,
  MutePlayer,
  PlayerId,
  ReportMessage,
  ReportsQuery,
  ResolveReport,
  SendMessage,
  type ChatConversations,
  type ChatMessageView,
  type ChatModeratedMessage,
  type ChatModeratedMessages,
  type ChatMuteList,
  type ChatMuteView,
  type ChatPage,
  type ChatReportList,
  type ChatReportView,
  type ChatUnread,
} from '@gravoth/contracts';
import { ChatModeration } from './chat-moderation.js';
import { ChatReports } from './chat-reports.js';
import { ChatSends } from './chat-sends.js';
import { Chat } from './chat.service.js';
import { MarkPresence } from '../presence/presence.js';

const ok = HttpStatusCode.OK;
const readGlobal = { query: ChatQuery } as const;
const sendGlobal = { body: SendMessage, status: ok } as const;
const readDirect = { params: PlayerId, query: ChatQuery } as const;
const sendDirect = { params: PlayerId, body: SendMessage, status: ok } as const;
const markRead = { params: PlayerId, body: MarkRead, status: ok } as const;
const acceptRules = { status: ok } as const;
const report = { params: MessageId, body: ReportMessage, status: ok } as const;

/**
 * Per address, over the per-player limit (`CHAT_LIMITS.SENDS_PER_MINUTE`, chat-sends.ts): many accounts from one
 * script stop here, while a carrier's shared address still has room for its players.
 */
const SENDS_PER_ADDRESS = { limit: 300, windowSeconds: 60 } as const;

/**
 * Chat (decision 228), read by polling: the global channel, direct messages between friends, the unread badge, the
 * rules and reports. Every route needs an account that can sign in again (403 `GUEST_ACCOUNT` for a guest). A send
 * answers 403 `CHAT_RULES`, `CHAT_MUTED` (`until`, `reason`) or `NOT_FRIENDS`, 422 `LINKS_NOT_ALLOWED` or
 * `MESSAGE_NOT_ALLOWED`, 429 `TOO_MANY_REQUESTS` (`Retry-After`), 409 `CHAT_REPEAT`.
 */
@UseGuards(SessionGuard, MarkPresence)
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: Chat,
    private readonly sends: ChatSends,
    private readonly reports: ChatReports,
  ) {}

  /** Oldest first; `after` (the poll, `gap` when more than `take` are newer) or `before` (scrolling back). */
  @Get('/global', readGlobal)
  global({ query }: Input<typeof readGlobal>): Promise<ChatPage> {
    return this.chat.page(undefined, query);
  }

  @Throttle(SENDS_PER_ADDRESS)
  @Post('/global', sendGlobal)
  sendGlobal({ body }: Input<typeof sendGlobal>): Promise<ChatMessageView> {
    return this.sends.send(undefined, body.body);
  }

  /** The players with a conversation, the newest first. */
  @Get('/direct')
  async conversations(): Promise<ChatConversations> {
    return { conversations: await this.chat.conversations() };
  }

  /** The conversation with a player (readable once they are no longer friends). 404 `PLAYER_NOT_FOUND`. */
  @Get('/direct/:userId', readDirect)
  direct({ params, query }: Input<typeof readDirect>): Promise<ChatPage> {
    return this.chat.page(params.userId, query);
  }

  /** To a friend only: 403 `NOT_FRIENDS` for anyone else. */
  @Throttle(SENDS_PER_ADDRESS)
  @Post('/direct/:userId', sendDirect)
  sendDirect({
    params,
    body,
  }: Input<typeof sendDirect>): Promise<ChatMessageView> {
    return this.sends.send(params.userId, body.body);
  }

  @Post('/direct/:userId/read', markRead)
  async read({
    params,
    body,
  }: Input<typeof markRead>): Promise<{ read: true }> {
    await this.chat.markRead(params.userId, body.upTo);
    return { read: true };
  }

  @Get('/unread')
  unread(): Promise<ChatUnread> {
    return this.chat.unread();
  }

  @Post('/rules/accept', acceptRules)
  async rules(): Promise<{ accepted: true }> {
    await this.chat.acceptRules();
    return { accepted: true };
  }

  /** 404 `MESSAGE_NOT_FOUND` (not one the caller can see), 400 `CANNOT_REPORT_SELF`; twice changes nothing. */
  @Throttle({ limit: 120, windowSeconds: 3600 })
  @Post('/messages/:id/report', report)
  async report({
    params,
    body,
  }: Input<typeof report>): Promise<{ reported: true }> {
    await this.reports.report(params.id, body);
    return { reported: true };
  }
}

const listReports = { query: ReportsQuery } as const;
const resolve = { params: MessageId, body: ResolveReport, status: ok } as const;
const mute = { body: MutePlayer, status: ok } as const;
const unmute = { params: PlayerId, status: ok } as const;
const listMessages = { query: AdminChatQuery } as const;
const hide = { params: MessageId, status: ok } as const;

/** Moderation for the website's admin page (`/admin/chat`): the `admin` role only, 403 for anyone else. */
@UseGuards(SessionGuard, MarkPresence)
@Roles('admin')
@Controller('admin/chat')
export class AdminChatController {
  constructor(private readonly moderation: ChatModeration) {}

  /** Newest first; the next page is `before` the last one's id. */
  @Get('/reports', listReports)
  async reports({ query }: Input<typeof listReports>): Promise<ChatReportList> {
    return { reports: await this.moderation.reports(query) };
  }

  /** 404 `REPORT_NOT_FOUND`. Closes every open report of the same message. */
  @Post('/reports/:id/resolve', resolve)
  resolve({ params, body }: Input<typeof resolve>): Promise<ChatReportView> {
    return this.moderation.resolve(params.id, body);
  }

  @Get('/mutes')
  async mutes(): Promise<ChatMuteList> {
    return { mutes: await this.moderation.mutes() };
  }

  /** 404 `PLAYER_NOT_FOUND`. */
  @Post('/mutes', mute)
  mute({ body }: Input<typeof mute>): Promise<ChatMuteView> {
    return this.moderation.mute(body);
  }

  /** 404 `MUTE_NOT_FOUND`. */
  @Post('/mutes/:userId/remove', unmute)
  async unmute({ params }: Input<typeof unmute>): Promise<{ removed: true }> {
    await this.moderation.unmute(params.userId);
    return { removed: true };
  }

  @Get('/messages', listMessages)
  async messages({
    query,
  }: Input<typeof listMessages>): Promise<ChatModeratedMessages> {
    return { messages: await this.moderation.messages(query) };
  }

  /** 404 `MESSAGE_NOT_FOUND`. */
  @Post('/messages/:id/hide', hide)
  hide({ params }: Input<typeof hide>): Promise<ChatModeratedMessage> {
    return this.moderation.hide(params.id);
  }
}
