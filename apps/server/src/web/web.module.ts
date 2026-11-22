import { StaticModule } from '@dunx/http';
import { AppConfigService } from '../config.js';
import { isHashedAsset } from './spa-shell.middleware.js';

/**
 * The website (`apps/web`, built into `apps/web/dist` by `bun run build`),
 * served by the API itself, so the session cookie is first-party and nothing
 * the site sends is cross-site. `StaticFiles` and `SpaShell` are registered in
 * `main.ts`, which decides where in the chain they sit; this binds their
 * options. A checkout with no build serves the API alone.
 */
export const WebModule = StaticModule.forRootAsync({
  useFactory: (config: AppConfigService) => ({
    root: config.get('web').root,
    // A content-hashed name changes with its bytes, so it may be cached forever.
    immutable: isHashedAsset,
  }),
  inject: [AppConfigService] as const,
});
