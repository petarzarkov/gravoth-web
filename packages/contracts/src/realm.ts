import { z } from 'zod';
import {
  CLOUD_SAVE_MAX_BASE64,
  REALM_REASONS,
  type HeroClass,
} from './constants.js';

/**
 * The online realm (decision 227): one save per account (the game's own save text, the phone's format) holding all
 * of the account's online heroes, their stash and codex, kept by the server. One device plays it at a time (the
 * lease, `REALM_LEASE_SECONDS`, renewed by every upload and lease call); every upload names the revision it builds on.
 * The rules checker reads each accepted upload after the reply, and its verdicts land on the heroes and the boards.
 * Every route needs an account that can sign in again: a guest gets 403 `GUEST_ACCOUNT`.
 */

/** The device's own id for the lease (the game's install id); any text, at most 128 characters. Decision 229: also an offline hero's phone. */
export const DeviceId = z.string().trim().min(1).max(128);

/** `POST /api/realm/lease`: take the lease, or renew it. `force` takes it from another device (whose next upload gets 409 `LEASE_LOST`). */
export const RealmLease = z
  .object({ deviceId: DeviceId, force: z.boolean().default(false) })
  .meta({
    id: 'RealmLease',
    description: "Take or renew the realm's one-device lease",
  });

export type RealmLease = z.infer<typeof RealmLease>;

/** `POST /api/realm/lease`; 409 `REALM_LEASED` answers `{ leaseUntil }` while another device holds a live lease. */
export interface RealmLeaseView {
  readonly revision: number;
  readonly leaseUntil: string;
}

/** `PUT /api/realm`: the whole realm, replacing the stored one at `baseRevision`. */
export const RealmWrite = z
  .object({
    deviceId: DeviceId,
    /** The revision this upload builds on: the current one, or 409 `REVISION_MISMATCH` answers `{ revision }`. 0 for the first. */
    baseRevision: z.number().int().min(0).max(2_147_483_647),
    /** base64 of the save's bytes, at most `CLOUD_SAVE_MAX_BYTES` (3 MB) decoded (413 `SAVE_TOO_LARGE`). */
    data: z
      .string()
      .min(4)
      .max(CLOUD_SAVE_MAX_BASE64)
      .regex(/^[A-Za-z0-9+/]+=*$/),
    reason: z.enum(REALM_REASONS),
    /** The realm's character ids of offline heroes moved online by this upload (once each: 409 `ALREADY_TRANSFERRED`). */
    transferred: z.array(z.number().int().min(0)).max(64).default([]),
  })
  .meta({
    id: 'RealmWrite',
    description: 'The online realm, uploaded whole at a checkpoint',
  });

export type RealmWrite = z.infer<typeof RealmWrite>;

/** `POST /api/realm/release`: at quit. */
export const RealmRelease = z.object({ deviceId: DeviceId }).meta({
  id: 'RealmRelease',
  description: "Give the realm's lease back",
});

export type RealmRelease = z.infer<typeof RealmRelease>;

/** One online hero of the realm, as the server knows it from the rules checker's last read. */
export interface RealmHero {
  /** The hero's id in the realm's save (`CharacterSave.Id`). */
  readonly characterId: number;
  /** The server's hero id (its player page, builds and records). */
  readonly heroId: string;
  readonly name: string;
  readonly class: HeroClass;
  readonly level: number;
  readonly hardcore: boolean;
  /** The rules checker found the hero implausible: kept, never shown on the boards. */
  readonly flagged: boolean;
}

/** `GET /api/realm`. `exists: false` (revision 0, data null) before the first upload. */
export interface RealmView {
  readonly exists: boolean;
  readonly revision: number;
  /** base64 of the save's bytes; null when there is none. */
  readonly data: string | null;
  readonly updatedAt: string | null;
  /** The revision the rules checker last read: `heroes` (and the boards) are its verdicts; behind `revision` while it reads. */
  readonly checkedRevision: number;
  readonly heroes: readonly RealmHero[];
}

/** `PUT /api/realm`: the new revision, and the heroes as they stand (this upload's checks land after the reply). */
export interface RealmWritten {
  readonly revision: number;
  readonly heroes: readonly RealmHero[];
}

/** `POST /api/realm/release`: false when this device held no lease. */
export interface RealmReleased {
  readonly released: boolean;
}

/** The extra fields of a realm route's 409s, beside `error` and `status`. */
export interface RealmConflict {
  readonly error:
    | 'REALM_LEASED'
    | 'LEASE_LOST'
    | 'REVISION_MISMATCH'
    | 'ALREADY_TRANSFERRED';
  readonly status: 409;
  /** `REALM_LEASED`: when the other device's lease ends. */
  readonly leaseUntil?: string;
  /** `REVISION_MISMATCH`: the current revision. */
  readonly revision?: number;
  /** `ALREADY_TRANSFERRED`: the heroes moved online before. */
  readonly characterIds?: readonly number[];
}
