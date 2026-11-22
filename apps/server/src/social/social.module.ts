import { Module } from '@dunx/core';
import { AccountsModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MailModule } from '../mail/mail.module.js';
import { PlayersModule } from '../players/players.module.js';
import { Blocks } from './blocks.service.js';
import { Friends } from './friends.service.js';
import { BlocksController, FriendsController, ProfileController } from './social.controllers.js';

/** The player's profile, friends and blocks (docs/online-plan.md, step 6's first half). Chat and presence join here. */
@Module({
  imports: [AccountsModule, DatabaseModule, MailModule, PlayersModule],
  controllers: [ProfileController, FriendsController, BlocksController],
  providers: [Friends, Blocks],
})
export class SocialModule {}
