import { Controller, Get } from '@dunx/http';
import { DbConnection } from '@dunx/infra/db';
import { GravothMeta } from './meta.service.js';
import { ValidatorClient } from './validator.client.js';

/**
 * The game's first routes (docs/online-plan.md, step 1): `/api/health` for the Compose healthcheck and the uptime monitor, and
 * `/api/meta` for the game and the website (the server's version, and the oldest game version it still serves).
 */
@Controller('')
export class MetaController {
  constructor(
    private readonly meta: GravothMeta,
    private readonly validator: ValidatorClient,
    private readonly database: DbConnection,
  ) {}

  /**
   * Always 200 while the process serves (the Compose healthcheck); `database` and `validator` say whether Postgres and
   * the rules checker answer, for the uptime monitor.
   */
  @Get('/health')
  async health(): Promise<{
    status: 'ok';
    uptimeSeconds: number;
    database: 'up' | 'down';
    validator: 'up' | 'down';
  }> {
    const [database, validator] = await Promise.all([
      this.databaseUp(),
      this.validator.up(),
    ]);
    return {
      status: 'ok',
      uptimeSeconds: this.meta.uptimeSeconds(),
      database: database ? 'up' : 'down',
      validator: validator ? 'up' : 'down',
    };
  }

  @Get('/meta')
  info(): ReturnType<GravothMeta['info']> {
    return this.meta.info();
  }

  private async databaseUp(): Promise<boolean> {
    try {
      await Promise.race([
        this.database.ping(),
        Bun.sleep(1000).then(() => Promise.reject(new Error('timeout'))),
      ]);
      return true;
    } catch {
      return false;
    }
  }
}
