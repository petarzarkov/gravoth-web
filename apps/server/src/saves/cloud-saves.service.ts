import { HttpError, HttpStatusCode, ValidationError } from '@dunx/http';
import {
  CLOUD_SAVE_MAX_BYTES,
  type CloudSaveView,
  type CloudSaveWrite,
} from '@gravoth/contracts';
import { eq } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { cloudSave } from '../database/schema.js';
export type { CloudSaveView, CloudSaveWrite };

/** What GET answers when the account has no cloud save. */
const NONE: CloudSaveView = {
  exists: false,
  data: null,
  description: '',
  playSeconds: 0,
  gameVersion: null,
  size: 0,
  updatedAt: null,
};

/** Everything about a copy but its bytes: what the website reads, and what a write answers. */
const ABOUT = {
  description: cloudSave.description,
  playSeconds: cloudSave.playSeconds,
  gameVersion: cloudSave.gameVersion,
  size: cloudSave.size,
  updatedAt: cloudSave.updatedAt,
} as const;

interface About {
  readonly description: string;
  readonly playSeconds: number;
  readonly gameVersion: string | null;
  readonly size: number;
  readonly updatedAt: Date;
}

const viewOf = (row: About, data: Uint8Array | null): CloudSaveView => ({
  exists: true,
  data: data === null ? null : Buffer.from(data).toString('base64'),
  description: row.description,
  playSeconds: row.playSeconds,
  gameVersion: row.gameVersion,
  size: row.size,
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * The bytes a `CloudSaveWrite`'s `data` stands for. Its pattern lets through strings that are not base64 (a length
 * that is not a multiple of four, padding with nothing to pad, bits after the last byte), which `Buffer` would decode
 * anyway by guessing; only data that encodes back to itself is taken, so the bytes kept are the ones the game sent.
 * Refused as a 400 in the shape the schema's own refusals have.
 */
export const decodeSave = (data: string): Uint8Array => {
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== data)
    throw new ValidationError('body', [
      { message: 'Not base64: it does not decode', path: 'data' },
    ]);
  if (bytes.length > CLOUD_SAVE_MAX_BYTES)
    throw new HttpError(HttpStatusCode.PAYLOAD_TOO_LARGE, 'SAVE_TOO_LARGE');
  return bytes;
};

const sha256 = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

/**
 * The game's cloud save (decision 225): one copy per account, which the game reads and replaces whole and the website
 * shows and deletes. The routes pass the session's own user, so a caller only ever reaches its own copy; a guest never
 * gets here.
 */
export class CloudSaves {
  constructor(private readonly db: Db) {}

  async read(userId: string, withData: boolean): Promise<CloudSaveView> {
    const mine = eq(cloudSave.userId, userId);
    if (!withData) {
      const [row] = await this.db.select(ABOUT).from(cloudSave).where(mine);
      return row === undefined ? NONE : viewOf(row, null);
    }
    const [row] = await this.db
      .select({ ...ABOUT, data: cloudSave.data })
      .from(cloudSave)
      .where(mine);
    return row === undefined ? NONE : viewOf(row, row.data);
  }

  /** Replaces the account's copy whole (or stores the first), and answers it without the data. */
  async write(userId: string, input: CloudSaveWrite): Promise<CloudSaveView> {
    const bytes = decodeSave(input.data);
    const copy = {
      data: bytes,
      description: input.description,
      playSeconds: input.playSeconds,
      gameVersion: input.gameVersion ?? null,
      size: bytes.length,
      sha256: sha256(bytes),
      updatedAt: new Date(),
    };
    const [row] = await this.db
      .insert(cloudSave)
      .values({ userId, ...copy })
      .onConflictDoUpdate({ target: cloudSave.userId, set: copy })
      .returning(ABOUT);
    if (row === undefined) throw new Error('cloud save not stored');
    return viewOf(row, null);
  }

  /** False when there was no copy. */
  async remove(userId: string): Promise<boolean> {
    const gone = await this.db
      .delete(cloudSave)
      .where(eq(cloudSave.userId, userId))
      .returning({ userId: cloudSave.userId });
    return gone.length > 0;
  }
}
