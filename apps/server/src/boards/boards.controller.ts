import { Auth, AuthContext, SessionGuard } from '@dunx/auth';
import {
  Controller,
  Get,
  HttpStatusCode,
  Post,
  Public,
  Throttle,
  UseGuards,
  type Input,
} from '@dunx/http';
import {
  AroundMe,
  BoardKey,
  ListBoards,
  ReadBoard,
  SubmitScore,
} from '@gravoth/contracts';
import {
  Boards,
  type BoardPage,
  type BoardView,
  type Neighbourhood,
  type SubmitResult,
} from './boards.service.js';

const listBoards = { query: ListBoards } as const;
const readBoard = { params: BoardKey, query: ReadBoard } as const;
const aroundMe = { params: BoardKey, query: AroundMe } as const;
const submit = {
  params: BoardKey,
  body: SubmitScore,
  status: HttpStatusCode.OK,
} as const;

/**
 * The boards (step 4): every board, the top of one with each row's whole build, the caller's place with the rows
 * around it, a friends-only view and a hardcore filter, and posting a score with its build. The game's own keys work
 * as they are (`hc_pit_floor` is the hardcore twin of `pit_floor`). Reading is public, for the website.
 */
@UseGuards(SessionGuard)
@Controller('leaderboards')
export class BoardsController {
  constructor(
    private readonly boards: Boards,
    private readonly auth: Auth,
    private readonly context: AuthContext,
  ) {}

  @Public()
  @Get('/', listBoards)
  async list({
    query,
  }: Input<typeof listBoards>): Promise<{ boards: BoardView[] }> {
    return { boards: await this.boards.list(query) };
  }

  /** A public read that still knows the caller when there is one: their own hidden name, and the friends view. */
  @Public()
  @Get('/:key', readBoard)
  async read({
    req,
    params,
    query,
  }: Input<typeof readBoard>): Promise<BoardPage> {
    const board = await this.boards.resolve(
      params.key,
      query.hardcore,
      query.season,
    );
    const caller =
      req.headers.has('authorization') || req.headers.has('cookie')
        ? (await this.auth.api.getSession({ headers: req.headers }))?.user.id
        : undefined;
    return this.boards.read(board, query, {
      caller,
      friends: query.view === 'friends',
      heroClass: query.class,
      path: query.path,
    });
  }

  @Get('/:key/me', aroundMe)
  async around({
    params,
    query,
  }: Input<typeof aroundMe>): Promise<Neighbourhood> {
    const board = await this.boards.resolve(
      params.key,
      query.hardcore,
      query.season,
    );
    return this.boards.around(
      board,
      this.context.require().user.id,
      query.around,
      {
        friends: query.view === 'friends',
        heroClass: query.class,
        path: query.path,
      },
    );
  }

  /** 404 `BOARD_NOT_FOUND` / `HERO_NOT_FOUND`, 409 `BUILD_REVISION_TAKEN`, 422 `HARDCORE_MISMATCH` / `SCORE_OUT_OF_RANGE`. */
  @Throttle({ limit: 120, windowSeconds: 3600 })
  @Post('/:key/scores', submit)
  submit({ params, body }: Input<typeof submit>): Promise<SubmitResult> {
    return this.boards.submit(this.context.require().user.id, params.key, body);
  }
}
