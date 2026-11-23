import { AuthContext, SessionGuard } from '@dunx/auth';
import {
  Controller,
  Get,
  HttpStatusCode,
  Patch,
  Post,
  Throttle,
  UseGuards,
  type Input,
} from '@dunx/http';
import type { Page } from '@dunx/infra/pagination';
import {
  PageQuery,
  PlayerId,
  RequestId,
  ToPlayer,
  UpdateProfile,
  type SuggestionList,
} from '@gravoth/contracts';
import { Profiles, type ProfileView } from '../players/profiles.service.js';
import { Blocks, type BlockView } from './blocks.service.js';
import {
  Friends,
  type FriendView,
  type RequestOutcome,
  type RequestView,
} from './friends.service.js';
import { callerOf } from './players.js';
import { Suggestions } from './suggestions.service.js';
import { MarkPresence } from '../presence/presence.js';

const ok = HttpStatusCode.OK;
const updateProfile = { body: UpdateProfile } as const;
const listPage = { query: PageQuery } as const;
const sendRequest = { body: ToPlayer, status: ok } as const;
const onRequest = { params: RequestId, status: ok } as const;
const onPlayer = { params: PlayerId, status: ok } as const;
const blockPlayer = { body: ToPlayer, status: ok } as const;
const dismissSuggestion = {
  params: PlayerId,
  status: HttpStatusCode.NO_CONTENT,
} as const;

/** The caller's own profile: the display name others see, and the privacy flags. */
@UseGuards(SessionGuard, MarkPresence)
@Controller('profile')
export class ProfileController {
  constructor(
    private readonly profiles: Profiles,
    private readonly context: AuthContext,
  ) {}

  @Get('/')
  async mine(): Promise<ProfileView> {
    const { user } = this.context.require();
    return this.profiles.view(user.id, user.name, callerOf(this.context).guest);
  }

  /** 409 `NAME_TAKEN`, 422 `NAME_NOT_ALLOWED` (the word filter), 409 `NO_PROVIDER_PHOTO` (`avatar: 'provider'` without one). */
  @Patch('/', updateProfile)
  update({ body }: Input<typeof updateProfile>): Promise<ProfileView> {
    return this.profiles.update(callerOf(this.context).id, body);
  }
}

/**
 * Friends (an account, not a guest): send a request to a display name, accept, decline or cancel one, remove a friend,
 * list friends and requests both ways, and the suggestions (decision 229). Every action is a POST, which every client
 * (Unity's among them) sends with a body intact.
 */
@UseGuards(SessionGuard, MarkPresence)
@Controller('friends')
export class FriendsController {
  constructor(
    private readonly friends: Friends,
    private readonly suggestions: Suggestions,
  ) {}

  @Get('/', listPage)
  list({ query }: Input<typeof listPage>): Promise<Page<FriendView>> {
    return this.friends.list(query);
  }

  @Get('/requests/incoming', listPage)
  incoming({ query }: Input<typeof listPage>): Promise<Page<RequestView>> {
    return this.friends.requests('incoming', query);
  }

  @Get('/requests/outgoing', listPage)
  outgoing({ query }: Input<typeof listPage>): Promise<Page<RequestView>> {
    return this.friends.requests('outgoing', query);
  }

  /**
   * `pending`, or `accepted` when they had already asked the caller. 404 `PLAYER_NOT_FOUND` (no such player, or one who
   * blocked the caller), 409 `ALREADY_FRIENDS` / `ALREADY_REQUESTED` / `PLAYER_BLOCKED`, 403 `REQUESTS_CLOSED`.
   */
  @Throttle({ limit: 30, windowSeconds: 3600 })
  @Post('/requests', sendRequest)
  request({ body }: Input<typeof sendRequest>): Promise<RequestOutcome> {
    return this.friends.request(body.displayName);
  }

  @Post('/requests/:id/accept', onRequest)
  accept({ params }: Input<typeof onRequest>): Promise<FriendView> {
    return this.friends.accept(params.id);
  }

  @Post('/requests/:id/decline', onRequest)
  async decline({
    params,
  }: Input<typeof onRequest>): Promise<{ declined: true }> {
    await this.friends.decline(params.id);
    return { declined: true };
  }

  @Post('/requests/:id/cancel', onRequest)
  async cancel({
    params,
  }: Input<typeof onRequest>): Promise<{ cancelled: true }> {
    await this.friends.cancel(params.id);
    return { cancelled: true };
  }

  @Post('/:userId/remove', onPlayer)
  async remove({ params }: Input<typeof onPlayer>): Promise<{ removed: true }> {
    await this.friends.remove(params.userId);
    return { removed: true };
  }

  /**
   * Decision 229: at most 20 players the caller may want to know, the best first, each with its reasons and the line
   * to show (suggestions.service.ts). 60 an hour per address; a list is cached for five minutes, dropped at once by a
   * request, an answer, a removal, a block or a dismissal.
   */
  @Throttle({ limit: 60, windowSeconds: 3600 })
  @Get('/suggestions')
  suggested(): Promise<SuggestionList> {
    return this.suggestions.list();
  }

  /** 204: the player is left out of the caller's suggestions for 30 days. 404 `PLAYER_NOT_FOUND`; 120 an hour. */
  @Throttle({ limit: 120, windowSeconds: 3600 })
  @Post('/suggestions/:userId/dismiss', dismissSuggestion)
  async dismiss({ params }: Input<typeof dismissSuggestion>): Promise<void> {
    await this.suggestions.dismiss(params.userId);
  }
}

/** Blocks: whom the caller blocked, block by display name, unblock. */
@UseGuards(SessionGuard, MarkPresence)
@Controller('blocks')
export class BlocksController {
  constructor(private readonly blocks: Blocks) {}

  @Get('/', listPage)
  list({ query }: Input<typeof listPage>): Promise<Page<BlockView>> {
    return this.blocks.list(query);
  }

  @Post('/', blockPlayer)
  block({ body }: Input<typeof blockPlayer>): Promise<BlockView> {
    return this.blocks.block(body.displayName);
  }

  @Post('/:userId/remove', onPlayer)
  async unblock({
    params,
  }: Input<typeof onPlayer>): Promise<{ unblocked: true }> {
    await this.blocks.unblock(params.userId);
    return { unblocked: true };
  }
}
