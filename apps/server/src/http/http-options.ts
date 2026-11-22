import {
  HttpOptionsProvider,
  WsRelay,
  type CorsOptions,
  type CsrfOptions,
  type PubSubRelay,
  type RequestLoggingOptions,
} from '@dunx/http';
import { AppConfigService, RELAY_CHANNEL } from '../config.js';

/**
 * The HTTP settings that come from validated config, answered from the container
 * rather than computed before it exists.
 */
export class AppHttpOptions extends HttpOptionsProvider {
  constructor(
    private readonly config: AppConfigService,
    // The contract, not `RedisRelay`, so the backend changes without this moving.
    private readonly bus: WsRelay,
  ) {
    super();
    this.trustProxy = this.config.get('trustProxy');
  }

  /**
   * Defaults to **false**: believing `x-forwarded-for` with no proxy stripping it
   * lets any caller pick its own address. The image sets it, since the API only
   * ever sits behind the Cloudflare Tunnel.
   */
  override readonly trustProxy: boolean;

  override get hostname(): string | undefined {
    return this.config.get('hostname');
  }

  override get prefix(): string {
    return 'api';
  }

  override get cors(): CorsOptions {
    return {
      origin: this.config.get('corsOrigin'),
      credentials: true,
      maxAge: 600,
    };
  }

  /**
   * A browser's cross-site `POST` is refused with a 403; the website (the CORS
   * origin) is the one other site trusted. The game sends neither `Origin` nor
   * `Sec-Fetch-Site`, so it passes like any non-browser client.
   */
  override get csrf(): CsrfOptions {
    const origin = URL.parse(this.config.get('corsOrigin'))?.origin;
    return {
      trustedOrigins: origin === undefined || origin === 'null' ? [] : [origin],
    };
  }

  override get relay(): PubSubRelay {
    return this.bus;
  }

  override readonly relayChannel = RELAY_CHANNEL;

  override get requestLogging(): RequestLoggingOptions {
    const log = this.config.get('log');
    return {
      // Off by default: both cost a `req.clone().text()` on the hot path, and a
      // body can carry a password.
      requestBody: log.requestBody,
      responseBody: log.responseBody,
      ignorePrefix: ['/api/dashboard', '/api/health'],
    };
  }
}
