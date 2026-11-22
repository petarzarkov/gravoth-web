import { Module } from '@dunx/core';
import { ScheduleModule } from '@dunx/infra/schedule';
import { AppConfigService } from '../config.js';

/**
 * `Bun.cron` behind `@Cron`, `@Interval` and `@OnceOnBoot`, armed at boot for every
 * provider in the app that carries one.
 *
 * `keepAlive: false`: the server holds the event loop open already, and a test that
 * boots the app has to be able to exit. `tz` comes from the config.
 */
@Module({
  imports: [
    ScheduleModule.forRootAsync({
      useFactory: (config: AppConfigService) => ({
        tz: config.get('schedule').tz,
        keepAlive: false,
      }),
      inject: [AppConfigService] as const,
    }),
  ],
})
export class MaintenanceModule {}
