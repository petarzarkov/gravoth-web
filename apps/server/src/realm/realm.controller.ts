import { AuthContext, SessionGuard } from '@dunx/auth';
import {
  Controller,
  Get,
  HttpStatusCode,
  Post,
  Put,
  Throttle,
  UseGuards,
  type Input,
} from '@dunx/http';
import {
  GAME_CLIENT_HEADER,
  RealmLease,
  RealmRelease,
  RealmWrite,
  type RealmLeaseView,
  type RealmReleased,
  type RealmView,
  type RealmWritten,
} from '@gravoth/contracts';
import { saveBody } from '../saves/saves.controller.js';
import { requireAccount } from '../social/players.js';
import { Realms, gameVersionOf } from './realms.service.js';

const ok = HttpStatusCode.OK;
const lease = { body: RealmLease, status: ok } as const;
const write = { body: RealmWrite, bodyParser: saveBody } as const;
const release = { body: RealmRelease, status: ok } as const;

/**
 * The online realm (decision 227): the account's online heroes in one save, one device at a time. Every route needs an
 * account that can sign in again (403 `GUEST_ACCOUNT` for a guest).
 */
@UseGuards(SessionGuard)
@Controller('realm')
export class RealmController {
  constructor(
    private readonly realms: Realms,
    private readonly context: AuthContext,
  ) {}

  /** 409 `REALM_LEASED` `{ leaseUntil }` while another device holds a live lease, unless `force`. */
  @Throttle({ limit: 240, windowSeconds: 3600 })
  @Post('/lease', lease)
  take({ body }: Input<typeof lease>): Promise<RealmLeaseView> {
    return this.realms.lease(
      requireAccount(this.context).id,
      body.deviceId,
      body.force,
    );
  }

  /** `exists: false` before the first upload. */
  @Get('/')
  read(): Promise<RealmView> {
    return this.realms.read(requireAccount(this.context).id);
  }

  /**
   * 409 `LEASE_LOST`, `ALREADY_TRANSFERRED` `{ characterIds, sameAccount }` or `REVISION_MISMATCH` `{ revision }`; 413
   * `SAVE_TOO_LARGE` over 3 MB; 503 `CHECKER_UNAVAILABLE` when a transfer cannot be read. The checks run after the reply.
   */
  @Throttle({ limit: 900, windowSeconds: 3600 })
  @Put('/', write)
  replace({ req, body }: Input<typeof write>): Promise<RealmWritten> {
    return this.realms.write(
      requireAccount(this.context).id,
      body,
      gameVersionOf(req.headers.get(GAME_CLIENT_HEADER)),
    );
  }

  /** At quit: `released` false when this device held no live lease. */
  @Post('/release', release)
  async release({ body }: Input<typeof release>): Promise<RealmReleased> {
    return {
      released: await this.realms.release(
        requireAccount(this.context).id,
        body.deviceId,
      ),
    };
  }
}
