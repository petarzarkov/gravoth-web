import { Auth, betterAuthDocument } from '@dunx/auth';
import { ConfigInput, Logger, provide, type ConfigSource, type Registration } from '@dunx/core';
import { HttpFactory, RedisRelay, StaticFiles, ThrottleGuard, type HttpApp } from '@dunx/http';
import { OpenApiModule } from '@dunx/openapi';
import { SwaggerRenderer } from '@dunx/openapi/swagger';
import { AppModule } from './app.module.js';
import { AppConfigService, RELAY_CHANNEL } from './config.js';
import { SpaShell } from './web/spa-shell.middleware.js';

/**
 * One app for `bun run start`, `bun run dev` and the tests, and one file:
 * `createApp` is exported for a caller that wants the shape without a server, and
 * the block at the bottom serves it when this file is the entry point.
 *
 * `create()` boots the container and discovers routes and gateways; `listen()` is
 * what builds the `Bun.serve` route table. Everything between the two still gets to
 * shape it, and after `listen()` every one of those throws.
 *
 * `overrides` and `config` are for a test: an override replaces a binding (the mail transport, the sign-in
 * providers) everywhere before anything is built, and `config` is laid over `Bun.env` (a test's own database).
 */
export const createApp = async (options: { overrides?: readonly Registration[]; config?: ConfigSource } = {}): Promise<HttpApp> => {
  const overrides = [
    ...(options.overrides ?? []),
    ...(options.config === undefined ? [] : [provide(ConfigInput, { useValue: { ...Bun.env, ...options.config } })]),
  ];
  const app = await HttpFactory.create(
    OpenApiModule.forRootAsync({
      root: AppModule,
      // Which documentation UI. `ScalarRenderer` from '@dunx/openapi/scalar'
      // is the other one, and takes `@scalar/api-reference` instead.
      renderer: new SwaggerRenderer(),
      inject: [Auth] as const,
      useFactory: (auth: Auth) => ({
        title: '@gravoth/server',
        version: '0.1.0',
        contribute: [
          betterAuthDocument(auth, { basePath: '/api/auth', tag: 'Auth' }),
        ],
      }),
    }),
    {
      // Multi-node websocket fan-out on `Bun.RedisClient`, so it costs no
      // dependency. With no Redis running this degrades to single-process
      // behaviour, logs one warning, and the app still boots.
      websocket: { idleTimeout: 30 },
      relay: new RedisRelay({ connectionTimeout: 500 }),
      relayChannel: RELAY_CHANNEL,
      ...(overrides.length === 0 ? {} : { overrides }),
    },
  );

  app.setGlobalPrefix('api');
  app.set('trust proxy', true);
  app.enableCors({
    origin: app.get(AppConfigService).get('corsOrigin'),
    credentials: true,
    maxAge: 600,
  });
  app.use(ThrottleGuard);
  // The website (apps/web/dist): its page for the paths it owns, then its assets. Neither touches `/api`.
  app.use(SpaShell, StaticFiles);

  return app;
};

const start = async (): Promise<void> => {
  const app = await createApp();
  app.enableShutdownHooks();

  const config = app.get(AppConfigService);
  const logger = app.get(Logger);
  const url = await app.listen(config.get('port'));

  logger.info(`listening on ${url}`);
  logger.info(`docs    ${new URL('api/docs', url).href}`);
  logger.info(`openapi ${new URL('api/openapi.json', url).href}`);

  // Nothing else to do: the server holds the process open, and the shutdown hooks
  // resolve this once a signal arrives.
  await app.closed;
};

// False when a test imports this file for `createApp` alone, which is what lets one
// module be both the entry point and the app's definition.
if (import.meta.main) {
  start().catch((error: unknown) => {
    console.error('failed to start', error);
    process.exit(1);
  });
}
