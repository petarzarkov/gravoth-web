import { z } from 'zod';
import { CLOUD_SAVE_MAX_BASE64 } from './constants.js';

/**
 * Cloud saves (decision 225): one copy of the game's whole save per account, never a guest's (a guest has no way back
 * in). The game is the one writer: its own rule compares fingerprints, uploads at most once a minute and on pause, and
 * asks the player when the phone and the cloud differ. The server keeps the decoded bytes; the website shows the copy
 * and deletes it.
 */

/** PUT /api/saves/me: the game's whole cloud copy (base64 of the bytes it writes), what the choice card shows, and the play time. */
export const CloudSaveWrite = z
  .object({
    data: z
      .string()
      .min(4)
      .max(CLOUD_SAVE_MAX_BASE64)
      .regex(/^[A-Za-z0-9+/]+=*$/),
    description: z.string().max(200).default(''),
    playSeconds: z.number().int().min(0).max(10_000_000_000).default(0),
    gameVersion: z
      .string()
      .regex(/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,4}$/)
      .optional(),
  })
  .meta({
    id: 'CloudSaveWrite',
    description: "The account's cloud save, replaced whole",
  });

export type CloudSaveWrite = z.infer<typeof CloudSaveWrite>;

/** GET /api/saves/me's query: `?data=false` leaves the data out (the website). */
export const CloudSaveRead = z.object({
  data: z.stringbool().default(true),
});

export type CloudSaveRead = z.infer<typeof CloudSaveRead>;

/** GET /api/saves/me (?data=false leaves the data out: the website). */
export interface CloudSaveView {
  readonly exists: boolean;
  /** base64; null when there is none or ?data=false. */
  readonly data: string | null;
  readonly description: string;
  readonly playSeconds: number;
  readonly gameVersion: string | null;
  /** Bytes of the decoded data. */
  readonly size: number;
  readonly updatedAt: string | null;
}

/** DELETE /api/saves/me: false when there was no copy to delete. */
export interface CloudSaveDeleted {
  readonly deleted: boolean;
}
