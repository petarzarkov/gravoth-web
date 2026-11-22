import { Module } from '@dunx/core';
import { AccountsModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { ChatModeration } from './chat-moderation.js';
import { ChatReports } from './chat-reports.js';
import { ChatRetention } from './chat-retention.js';
import { ChatSends } from './chat-sends.js';
import { AdminChatController, ChatController } from './chat.controllers.js';
import { Chat } from './chat.service.js';

/**
 * Chat (decision 228): the global channel and friends' direct messages, read by polling, with the word filter, the
 * flood and repeat limits, reports, blocks and mutes; the admin page's moderation routes; and the daily retention job
 * (its `@Cron` armed by the schedule module).
 */
@Module({
  imports: [AccountsModule, DatabaseModule],
  controllers: [ChatController, AdminChatController],
  providers: [Chat, ChatSends, ChatReports, ChatModeration, ChatRetention],
})
export class ChatModule {}
