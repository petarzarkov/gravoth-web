import { Logger } from '@dunx/core';
import { HttpError, HttpStatusCode, ValidationError } from '@dunx/http';
import {
  REALM_LEASE_SECONDS,
  type RealmHero,
  type RealmLeaseView,
  type RealmView,
  type RealmWrite,
  type RealmWritten,
} from '@gravoth/contracts';
import { and, asc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { hero, realm, realmTransfer } from '../database/schema.js';
import { ValidatorClient } from '../gravoth/validator.client.js';
import { DetailedHttpError } from '../http/detailed-error.js';
import { decodeSave } from '../saves/cloud-saves.service.js';
import { RealmSync } from './realm-sync.js';

const sha256 = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

const leaseEnd = (now: Date): Date =>
  new Date(now.getTime() + REALM_LEASE_SECONDS * 1000);

/** The game's version from its `x-gravoth-client: game/<version>` header (decision 223), when it is one. */
export const gameVersionOf = (header: string | null): string | null => {
  const match = /^game\/([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,4})(?:$|[^0-9])/.exec(
    header ?? '',
  );
  return match?.[1] ?? null;
};

/**
 * The online realm (decision 227): one save per account holding all its online heroes, played by one device at a time.
 *
 * - **The lease** (`REALM_LEASE_SECONDS`): a lease call takes it when no other device holds a live one (or with
 *   `force`), and renews it for the device that holds it; every accepted upload renews it too. A device whose lease
 *   ran out keeps it until another takes it, so a connection drop longer than the lease (the grace) loses nothing.
 *   An upload from any device but the holder is 409 `LEASE_LOST`; release ends the holder's lease.
 * - **Revisions:** an upload names the revision it builds on; any other than the current one is 409
 *   `REVISION_MISMATCH` with the current revision (an older copy, a restored backup, another device's work).
 * - **Transfers:** an upload moving offline heroes online lists their ids in the realm; the rules checker reads them
 *   first (in the request: the answer needs it) and each one's fingerprint is kept, so the same hero moves once
 *   (409 `ALREADY_TRANSFERRED` with the ids moved before, for this account or another).
 * - **The checks** run after the reply (`RealmSync`): the heroes, their builds and the boards follow the realm.
 */
export class Realms {
  constructor(
    private readonly db: Db,
    private readonly validator: ValidatorClient,
    private readonly sync: RealmSync,
    private readonly logger: Logger,
  ) {}

  async lease(
    userId: string,
    deviceId: string,
    force: boolean,
  ): Promise<RealmLeaseView> {
    const now = new Date();
    const until = leaseEnd(now);
    const [taken] = await this.db
      .insert(realm)
      .values({ userId, leaseDevice: deviceId, leaseUntil: until })
      .onConflictDoUpdate({
        target: realm.userId,
        set: { leaseDevice: deviceId, leaseUntil: until },
        // Free, or this device's already, or taken by force.
        setWhere: force
          ? sql`true`
          : sql`(${realm.leaseDevice} = ${deviceId} OR ${realm.leaseUntil} IS NULL OR ${realm.leaseUntil} <= ${now.toISOString()}::timestamptz)`,
      })
      .returning({ revision: realm.revision, leaseUntil: realm.leaseUntil });
    if (taken === undefined) {
      const [held] = await this.db
        .select({ leaseUntil: realm.leaseUntil })
        .from(realm)
        .where(eq(realm.userId, userId))
        .limit(1);
      throw new DetailedHttpError(HttpStatusCode.CONFLICT, 'REALM_LEASED', {
        leaseUntil: (held?.leaseUntil ?? until).toISOString(),
      });
    }
    return {
      revision: taken.revision,
      leaseUntil: (taken.leaseUntil ?? until).toISOString(),
    };
  }

  async read(userId: string): Promise<RealmView> {
    const [row] = await this.db
      .select()
      .from(realm)
      .where(eq(realm.userId, userId))
      .limit(1);
    const heroes = await this.heroes(userId);
    if (row === undefined || row.data === null)
      return {
        exists: false,
        revision: row?.revision ?? 0,
        data: null,
        updatedAt: null,
        checkedRevision: row?.checkedRevision ?? 0,
        heroes,
      };
    return {
      exists: true,
      revision: row.revision,
      data: Buffer.from(row.data).toString('base64'),
      updatedAt: row.updatedAt.toISOString(),
      checkedRevision: row.checkedRevision,
      heroes,
    };
  }

  /** The realm replaced whole at `baseRevision + 1`; the checks run after the reply. */
  async write(
    userId: string,
    input: RealmWrite,
    gameVersion: string | null,
  ): Promise<RealmWritten> {
    const bytes = decodeSave(input.data);
    const moved = await this.fingerprints(bytes, input.transferred);
    const now = new Date();

    const revision = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          revision: realm.revision,
          leaseDevice: realm.leaseDevice,
        })
        .from(realm)
        .where(eq(realm.userId, userId))
        .for('update')
        .limit(1);
      if (current === undefined || current.leaseDevice !== input.deviceId)
        throw new HttpError(HttpStatusCode.CONFLICT, 'LEASE_LOST');
      if (current.revision !== input.baseRevision)
        throw new DetailedHttpError(
          HttpStatusCode.CONFLICT,
          'REVISION_MISMATCH',
          {
            revision: current.revision,
          },
        );

      if (moved.length > 0) {
        const kept = await tx
          .insert(realmTransfer)
          .values(
            moved.map(({ fingerprint, characterId }) => ({
              fingerprint,
              userId,
              characterId,
            })),
          )
          .onConflictDoNothing({ target: realmTransfer.fingerprint })
          .returning({ fingerprint: realmTransfer.fingerprint });
        const fresh = new Set(kept.map((row) => row.fingerprint));
        const before = moved.filter((m) => !fresh.has(m.fingerprint));
        if (before.length > 0)
          throw new DetailedHttpError(
            HttpStatusCode.CONFLICT,
            'ALREADY_TRANSFERRED',
            { characterIds: before.map((m) => m.characterId) },
          );
      }

      const [stored] = await tx
        .update(realm)
        .set({
          data: bytes,
          size: bytes.length,
          sha256: sha256(bytes),
          revision: sql`${realm.revision} + 1`,
          ...(gameVersion === null ? {} : { gameVersion }),
          leaseUntil: leaseEnd(now),
          updatedAt: now,
        })
        .where(eq(realm.userId, userId))
        .returning({ revision: realm.revision });
      if (stored === undefined) throw new Error('realm not stored');
      return stored.revision;
    });

    if (input.transferred.length > 0)
      this.logger.info('heroes moved online', {
        userId,
        characterIds: input.transferred,
        revision,
      });
    this.sync.schedule(userId);
    return { revision, heroes: await this.heroes(userId) };
  }

  /** Ends this device's lease; false when it held none. */
  async release(userId: string, deviceId: string): Promise<boolean> {
    const now = new Date();
    const ended = await this.db
      .update(realm)
      .set({ leaseUntil: now })
      .where(
        and(
          eq(realm.userId, userId),
          eq(realm.leaseDevice, deviceId),
          isNotNull(realm.leaseUntil),
          gt(realm.leaseUntil, now),
        ),
      )
      .returning({ userId: realm.userId });
    return ended.length > 0;
  }

  /** The account's online heroes as the rules checker last read them, in the realm's order. */
  async heroes(userId: string): Promise<RealmHero[]> {
    const rows = await this.db
      .select()
      .from(hero)
      .where(
        and(
          eq(hero.userId, userId),
          eq(hero.online, true),
          isNotNull(hero.realmCharacterId),
          isNull(hero.retiredAt),
        ),
      )
      .orderBy(asc(hero.realmCharacterId));
    return rows.map((row) => ({
      characterId: row.realmCharacterId ?? 0,
      heroId: row.id,
      name: row.name,
      class: row.class,
      level: row.level ?? 1,
      hardcore: row.hardcore,
      flagged: row.flagged,
    }));
  }

  /**
   * The transfer fingerprints of the heroes an upload moves online, from the rules checker's read of the realm (the
   * checker down, or older than the game: 503 `CHECKER_UNAVAILABLE`, and the game tries again with the hero still on
   * the phone). A listed id the realm does not hold is a 400.
   */
  private async fingerprints(
    bytes: Uint8Array,
    transferred: readonly number[],
  ): Promise<{ fingerprint: string; characterId: number }[]> {
    const ids = [...new Set(transferred)];
    if (ids.length === 0) return [];
    let report;
    try {
      report = await this.validator.heroes(Buffer.from(bytes).toString('utf8'));
    } catch (error) {
      this.logger.warn('the rules checker did not answer a transfer', {
        err: error,
      });
      throw new HttpError(
        HttpStatusCode.SERVICE_UNAVAILABLE,
        'CHECKER_UNAVAILABLE',
      );
    }
    if (!report.ok) {
      if (report.needsNewerBuild)
        throw new HttpError(
          HttpStatusCode.SERVICE_UNAVAILABLE,
          'CHECKER_UNAVAILABLE',
        );
      throw new ValidationError('body', [
        { message: 'The realm does not read as a save', path: 'data' },
      ]);
    }
    const byId = new Map(report.heroes.map((h) => [h.characterId, h]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0)
      throw new ValidationError('body', [
        {
          message: `The realm holds no hero ${missing.join(', ')}`,
          path: 'transferred',
        },
      ]);
    const seen = new Set<string>();
    const moved: { fingerprint: string; characterId: number }[] = [];
    for (const id of ids) {
      const fingerprint = byId.get(id)?.fingerprint ?? '';
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      moved.push({ fingerprint, characterId: id });
    }
    return moved;
  }
}
