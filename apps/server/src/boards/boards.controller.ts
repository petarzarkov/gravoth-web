import { Auth, AuthContext, SessionGuard } from '@dunx/auth';
import { Controller, Get, HttpStatusCode, Post, Public, Throttle, UseGuards, type Input } from '@dunx/http';
import { z } from 'zod';
import { HERO_CLASSES } from '../database/schema.js';
import { BuildSnapshot } from '../heroes/build.schema.js';
import { PageQuery } from '../http/page-query.js';
import { Boards, type BoardPage, type BoardView, type Neighbourhood, type SubmitResult } from './boards.service.js';

const BoardKey = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{1,42}$/) });

const Scope = z.object({
  /** For a key without the `hc_` prefix: the hardcore twin. */
  hardcore: z.stringbool().optional(),
  season: z.coerce.number().int().min(0).default(0),
  /** `friends`: the caller and their friends only (needs a session). */
  view: z.enum(['all', 'friends']).default('all'),
  class: z.enum(HERO_CLASSES).optional(),
});

const ListBoards = z.object({ hardcore: z.stringbool().optional(), season: z.coerce.number().int().min(0).optional() });

const SubmitScore = z
  .object({
    heroId: z.uuid(),
    score: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    /** When the hero set it; never later than the server's clock. Absent: now. */
    achievedAt: z.iso.datetime({ offset: true }).optional(),
    season: z.number().int().min(0).default(0),
    build: BuildSnapshot,
    /** The hero's save file as the game writes it, for the rules checker; without it the entry is `pending`. */
    save: z.string().min(1).max(2_000_000).optional(),
    /** The hero's id inside that save. */
    saveHeroId: z.number().int().min(0).optional(),
  })
  .meta({ id: 'SubmitScore', description: "A hero's score on a board, with the whole build that set it" });

const listBoards = { query: ListBoards } as const;
const readBoard = { params: BoardKey, query: PageQuery.extend(Scope.shape) } as const;
const aroundMe = { params: BoardKey, query: Scope.extend({ around: z.coerce.number().int().min(0).max(25).default(5) }) } as const;
const submit = { params: BoardKey, body: SubmitScore, status: HttpStatusCode.OK } as const;

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
  async list({ query }: Input<typeof listBoards>): Promise<{ boards: BoardView[] }> {
    return { boards: await this.boards.list(query) };
  }

  /** A public read that still knows the caller when there is one: their own hidden name, and the friends view. */
  @Public()
  @Get('/:key', readBoard)
  async read({ req, params, query }: Input<typeof readBoard>): Promise<BoardPage> {
    const board = await this.boards.resolve(params.key, query.hardcore, query.season);
    const caller = req.headers.has('authorization') ? (await this.auth.api.getSession({ headers: req.headers }))?.user.id : undefined;
    return this.boards.read(board, query, { caller, friends: query.view === 'friends', heroClass: query.class });
  }

  @Get('/:key/me', aroundMe)
  async around({ params, query }: Input<typeof aroundMe>): Promise<Neighbourhood> {
    const board = await this.boards.resolve(params.key, query.hardcore, query.season);
    return this.boards.around(board, this.context.require().user.id, query.around, { friends: query.view === 'friends', heroClass: query.class });
  }

  /** 404 `BOARD_NOT_FOUND` / `HERO_NOT_FOUND`, 409 `BUILD_REVISION_TAKEN`, 422 `HARDCORE_MISMATCH` / `SCORE_OUT_OF_RANGE`. */
  @Throttle({ limit: 120, windowSeconds: 3600 })
  @Post('/:key/scores', submit)
  submit({ params, body }: Input<typeof submit>): Promise<SubmitResult> {
    return this.boards.submit(this.context.require().user.id, params.key, body);
  }
}
