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
} from '@gravoth/contracts';
import {
  Profiles,
  toProfileView,
  type ProfileView,
} from '../players/profiles.service.js';
import { Blocks, type BlockView } from './blocks.service.js';
import {
  Friends,
  type FriendView,
  type RequestOutcome,
  type RequestView,
} from './friends.service.js';
import { callerOf } from './players.js';

const ok = HttpStatusCode.OK;
const updateProfile = { body: UpdateProfile } as const;
const listPage = { query: PageQuery } as const;
const sendRequest = { body: ToPlayer, status: ok } as const;
const onRequest = { params: RequestId, status: ok } as const;
const onPlayer = { params: PlayerId, status: ok } as const;
const blockPlayer = { body: ToPlayer, status: ok } as const;

/** The caller's own profile: the display name others see, and the privacy flags. */
@UseGuards(SessionGuard)
@Controller('profile')
export class ProfileController {
  constructor(
    private readonly profiles: Profiles,
    private readonly context: AuthContext,
  ) {}

  @Get('/')
  async mine(): Promise<ProfileView> {
    const { user } = this.context.require();
    return toProfileView(
      await this.profiles.ensure(
        user.id,
        user.name,
        callerOf(this.context).guest,
      ),
    );
  }

  /** 409 `NAME_TAKEN`, 422 `NAME_NOT_ALLOWED` (the word filter). */
  @Patch('/', updateProfile)
  async update({ body }: Input<typeof updateProfile>): Promise<ProfileView> {
    return toProfileView(
      await this.profiles.update(callerOf(this.context).id, body),
    );
  }
}

/**
 * Friends (an account, not a guest): send a request to a display name, accept, decline or cancel one, remove a friend,
 * and list friends and requests both ways. Every action is a POST, which every client (Unity's among them) sends with
 * a body intact.
 */
@UseGuards(SessionGuard)
@Controller('friends')
export class FriendsController {
  constructor(private readonly friends: Friends) {}

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
}

/** Blocks: whom the caller blocked, block by display name, unblock. */
@UseGuards(SessionGuard)
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
