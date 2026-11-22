import { AuthContext, SessionGuard } from '@dunx/auth';
import { Controller, Get, HttpStatusCode, Post, Public, UseGuards, type Input } from '@dunx/http';
import { RegisterHero } from '@gravoth/contracts';
import { z } from 'zod';
import { Builds, type BuildCard } from './builds.service.js';
import { Heroes, toHeroView, type HeroView } from './heroes.service.js';

const register = { body: RegisterHero, status: HttpStatusCode.OK } as const;
const byId = { params: z.object({ id: z.uuid() }) } as const;

/** The caller's heroes: register one (idempotent by name) so its records can go on the boards, and list them. */
@UseGuards(SessionGuard)
@Controller('heroes')
export class HeroesController {
  constructor(
    private readonly heroes: Heroes,
    private readonly context: AuthContext,
  ) {}

  @Get('/')
  async mine(): Promise<{ heroes: HeroView[] }> {
    return { heroes: (await this.heroes.mine(this.context.require().user.id)).map(toHeroView) };
  }

  /** `created` is false when the hero was already registered (after a reinstall, say). 409 `HERO_NAME_TAKEN` for another class. */
  @Post('/', register)
  async register({ body }: Input<typeof register>): Promise<{ hero: HeroView; created: boolean }> {
    const { hero, created } = await this.heroes.register(this.context.require().user.id, body);
    return { hero: toHeroView(hero), created };
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
