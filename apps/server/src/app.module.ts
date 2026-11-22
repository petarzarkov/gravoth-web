import { Auth } from '@dunx/auth';
import { ConfigModule, Module } from '@dunx/core';
import { StaticOptions } from '@dunx/http';
import { LoggerModule } from '@dunx/infra/logger';
import { AppConfigService, validate } from './config.js';
import { HttpModule } from './http/http.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AccountsModule } from './auth/auth.module.js';
import { CacheModule } from './cache/cache.module.js';
import { LimitsModule } from './throttle/throttle.module.js';
import { MaintenanceModule } from './schedule/schedule.module.js';
import { GravothModule } from './gravoth/gravoth.module.js';
import { BackupModule } from './backup/backup.module.js';
import { SocialModule } from './social/social.module.js';
import { HeroesModule } from './heroes/heroes.module.js';
import { BoardsModule } from './boards/boards.module.js';
import { WebModule } from './web/web.module.js';

/**
 * Import order is construction order, and shutdown runs in reverse - so config and
 * the logger are built first and torn down last, and anything a feature depends on
 * outlives it.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ validate, as: AppConfigService }),
    // The level comes from the validated config, which is the one thing a
    // zero-argument `forRoot` function cannot reach.
    LoggerModule.forRootAsync(
      {
        useFactory: (config: AppConfigService) => ({
          name: config.get('appName'),
          level: config.get('log').level,
        }),
        inject: [AppConfigService] as const,
      },
      { captureGlobalErrors: true },
    ),
    HttpModule,
    DatabaseModule,
    AccountsModule,
    CacheModule,
    LimitsModule,
    MaintenanceModule,
    GravothModule,
    BackupModule,
    SocialModule,
    HeroesModule,
    BoardsModule,
    WebModule,
  ],
  // Better Auth serves its own routes, so the document is the only place they
  // appear - and `betterAuthDocument` needs the instance. `StaticOptions` for the
  // website's middleware, which `app.use` resolves from the root (main.ts).
  exports: [Auth, StaticOptions],
})
export class AppModule {}
