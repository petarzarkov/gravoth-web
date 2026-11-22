import { AuthContext, SessionGuard } from '@dunx/auth';
import {
  Controller,
  Delete,
  Get,
  HttpError,
  HttpStatusCode,
  Put,
  Throttle,
  UseGuards,
  type Input,
} from '@dunx/http';
import {
  CLOUD_SAVE_MAX_BASE64,
  CloudSaveRead,
  CloudSaveWrite,
  type CloudSaveDeleted,
} from '@gravoth/contracts';
import { requireAccount } from '../social/players.js';
import { CloudSaves, type CloudSaveView } from './cloud-saves.service.js';

/**
 * The largest body a `CloudSaveWrite` can be, with room to spare: the longest data, a description of 200 characters
 * each escaped as `\uXXXX`, and the rest. Anything longer is refused before it is read.
 */
const MAX_BODY_BYTES = CLOUD_SAVE_MAX_BASE64 + 64_000;

const tooLarge = () =>
  new HttpError(HttpStatusCode.PAYLOAD_TOO_LARGE, 'SAVE_TOO_LARGE');

/**
 * The write's body, read as JSON before the schema checks it, so that a save too large to keep is a 413
 * `SAVE_TOO_LARGE` (what the game can tell apart) rather than the schema's own 400 on `data`'s length.
 */
const saveBody = async (req: Request): Promise<unknown> => {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES)
    throw tooLarge();
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw tooLarge();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (error) {
    throw new HttpError(HttpStatusCode.BAD_REQUEST, 'Malformed JSON body', {
      cause: error,
    });
  }
  const data = (body as { data?: unknown } | null)?.data;
  if (typeof data === 'string' && data.length > CLOUD_SAVE_MAX_BASE64)
    throw tooLarge();
  return body;
};

const read = { query: CloudSaveRead } as const;
const write = { body: CloudSaveWrite, bodyParser: saveBody } as const;

/**
 * The caller's cloud save (decision 225): the one copy of the game's whole save an account keeps, so its heroes outlive
 * a lost phone. The game reads it, replaces it whole (at most once a minute, and on pause) and compares it with the
 * phone's by its own rule; the website shows it (`?data=false`) and deletes it. Never a guest's: 403 `GUEST_ACCOUNT`,
 * since a guest has no way back in to read it.
 */
@UseGuards(SessionGuard)
@Controller('saves')
export class SavesController {
  constructor(
    private readonly saves: CloudSaves,
    private readonly context: AuthContext,
  ) {}

  /** `exists: false`, with nulls and zeros, when the account has none. */
  @Get('/me', read)
  mine({ query }: Input<typeof read>): Promise<CloudSaveView> {
    return this.saves.read(requireAccount(this.context).id, query.data);
  }

  /** Answers the stored copy without its data. 413 `SAVE_TOO_LARGE` over 3 MB; 400 for data that is not base64. */
  @Throttle({ limit: 240, windowSeconds: 3600 })
  @Put('/me', write)
  replace({ body }: Input<typeof write>): Promise<CloudSaveView> {
    return this.saves.write(requireAccount(this.context).id, body);
  }

  @Delete('/me')
  async remove(): Promise<CloudSaveDeleted> {
    return {
      deleted: await this.saves.remove(requireAccount(this.context).id),
    };
  }
}
