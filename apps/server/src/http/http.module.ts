import { Module, provide } from '@dunx/core';
import { HttpOptionsProvider, RelayPublisher, WsRelayModule } from '@dunx/http';
import { AppConfigService, RELAY_CHANNEL } from '../config.js';
import { AppErrorFilter } from './detailed-error.js';
import { AppHttpOptions } from './http-options.js';

@Module({
  imports: [
    /**
     * The WebSocket relay over Redis, for the chat gateway of step 6 (multi-node
     * fan-out). With no Redis it degrades to one process and logs one warning.
     */
    WsRelayModule.forRootAsync(
      {
        useFactory: (config: AppConfigService) => {
          const { url } = config.get('redis');
          return {
            ...(url === undefined ? {} : { url }),
            connectionTimeout: 500,
          };
        },
        inject: [AppConfigService] as const,
      },
      { channel: RELAY_CHANNEL },
    ),
  ],
  providers: [
    // The HTTP settings that read from config, resolved after the container
    // exists. `HttpFactory` promotes a default, so binding this replaces it.
    provide(HttpOptionsProvider, { useClass: AppHttpOptions }),
    // dunx's error bodies, with the details a `DetailedHttpError` carries (main.ts's `onError`).
    AppErrorFilter,
  ],
  exports: [HttpOptionsProvider, RelayPublisher, AppErrorFilter],
})
export class HttpModule {}
