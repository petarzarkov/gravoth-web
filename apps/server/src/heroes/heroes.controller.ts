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
  ActiveHeroes,
  PlayerId,
  PostHeroBuild,
  RegisterHero,
  type HeroBuildPosted,
  type HeroesRetired,
} from '@gravoth/contracts';
import { z } from 'zod';
import { Builds, toBuildView, type BuildCard } from './builds.service.js';
import { HeroBuilds } from './hero-builds.service.js';
import { Heroes, toHeroView, type HeroView } from './heroes.service.js';
import { PlayerPages, type PlayerPage } from './player-pages.service.js';

const register = { body: RegisterHero, status: HttpStatusCode.OK } as const;
const byId = { params: z.object({ id: z.uuid() }) } as const;
const postBuild = {
  params: z.object({ id: z.uuid() }),
  body: PostHeroBuild,
  status: HttpStatusCode.OK,
} as const;
const active = { body: ActiveHeroes, status: HttpStatusCode.OK } as const;
const player = { params: PlayerId } as const;

/** The caller's heroes: register one (idempotent by name) so its records can go on the boards, and list them. */
@UseGuards(SessionGuard)
@Controller('heroes')
export class HeroesController {
  constructor(
    private readonly heroes: Heroes,
    private readonly heroBuilds: HeroBuilds,
    private readonly context: AuthContext,
  ) {}

  @Get('/')
  async mine(): Promise<{ heroes: HeroView[] }> {
    return {
      heroes: (await this.heroes.mine(this.context.require().user.id)).map(
        toHeroView,
      ),
    };
  }

  /** `created` is false when the hero was already registered (after a reinstall, say). 409 `HERO_NAME_TAKEN` for another class. */
  @Post('/', register)
  async register({
    body,
  }: Input<typeof register>): Promise<{ hero: HeroView; created: boolean }> {
    const { hero, created } = await this.heroes.register(
      this.context.require().user.id,
      body,
    );
    return { hero: toHeroView(hero), created };
  }

  /**
   * Decision 226: the offline heroes still on the phone; the caller's other offline heroes are retired (gone from the
   * player page, their builds and records kept). An online hero is its realm's and never retired here.
   */
  @Post('/active', active)
  async active({ body }: Input<typeof active>): Promise<HeroesRetired> {
    return {
      retired: await this.heroBuilds.active(
        this.context.require().user.id,
        body.heroIds,
        body.deviceId,
      ),
    };
  }

  /**
   * Decision 226: the hero's build as it is now, for its player page; `created` false when it is the hero's latest
   * already. 404 `HERO_NOT_FOUND` for another account's hero, 409 `BUILD_REVISION_TAKEN` for another build at a used
   * revision, 409 `HERO_ONLINE` for an online hero (its builds come from its realm).
   */
  @Throttle({ limit: 120, windowSeconds: 3600 })
  @Post('/:id/builds', postBuild)
  async postBuild({
    params,
    body,
  }: Input<typeof postBuild>): Promise<HeroBuildPosted> {
    const { build, created } = await this.heroBuilds.post(
      this.context.require().user.id,
      params.id,
      body,
    );
    return { build: toBuildView(build), created };
  }
}

/**
 * Decision 226: a player page, all of a player's heroes with their builds and records. Public; a hidden profile's
 * page is 404 `PLAYER_NOT_FOUND` to anyone but a friend and the player, so the read still knows the caller when there
 * is one.
 */
@Public()
@Controller('players')
export class PlayersController {
  constructor(
    private readonly pages: PlayerPages,
    private readonly auth: Auth,
  ) {}

  @Get('/:userId', player)
  async page({ req, params }: Input<typeof player>): Promise<PlayerPage> {
    const caller =
      req.headers.has('authorization') || req.headers.has('cookie')
        ? (await this.auth.api.getSession({ headers: req.headers }))?.user.id
        : undefined;
    return this.pages.page(params.userId, caller);
  }
}

/** A build card by id: what a board row opens, on the game's BOARDS and on the website. Public. */
@Public()
@Controller('builds')
export class BuildsController {
  constructor(private readonly builds: Builds) {}

  @Get('/:id', byId)
  card({ params }: Input<typeof byId>): Promise<BuildCard> {
    return this.builds.card(params.id);
  }
}
