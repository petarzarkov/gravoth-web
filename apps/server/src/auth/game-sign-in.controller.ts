import {
  Controller,
  Get,
  HttpStatusCode,
  Post,
  Public,
  Throttle,
  type Input,
} from '@dunx/http';
import {
  GameSignInExchange,
  GameSignInStart,
  type GameSignInToken,
} from '@gravoth/contracts';
import { z } from 'zod';
import { GameSignIn } from './game-sign-in.js';

const start = { query: GameSignInStart } as const;
const done = {
  query: z.object({
    return: z.string().min(1).max(200),
    state: GameSignInStart.shape.state,
    /** better-auth's `?error=` when the provider sign-in failed or was cancelled. */
    error: z.string().max(200).optional(),
  }),
} as const;
const exchange = {
  body: GameSignInExchange,
  status: HttpStatusCode.OK,
} as const;

/**
 * The game's browser sign-in with Google or Discord (game-sign-in.ts): `GET /` and `GET /done` are opened in the
 * player's browser, `POST /exchange` is the game's own call.
 */
@Public()
@Controller('account/game-sign-in')
export class GameSignInController {
  constructor(private readonly signIn: GameSignIn) {}

  @Throttle({ limit: 30, windowSeconds: 600 })
  @Get('/', start)
  start({ query, req }: Input<typeof start>): Promise<Response> {
    return this.signIn.start(query, req);
  }

  @Get('/done', done)
  done({ query, req }: Input<typeof done>): Promise<Response> {
    return this.signIn.done(query, req);
  }

  @Throttle({ limit: 30, windowSeconds: 600 })
  @Post('/exchange', exchange)
  exchange({ body, req }: Input<typeof exchange>): Promise<GameSignInToken> {
    return this.signIn.exchange(body.code, req);
  }
}
