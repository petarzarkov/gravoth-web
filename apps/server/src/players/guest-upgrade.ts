import { Logger } from '@dunx/core';
import { eq } from 'drizzle-orm';
import { Db } from '../database/db.js';
import { hero, profile } from '../database/schema.js';

/**
 * A guest who signs up or signs in (email, Google, Discord) becomes that account, and better-auth then deletes the
 * guest. Before it does, this moves what the guest made: its heroes, with their builds and board entries (the entries
 * follow their hero through `ON UPDATE CASCADE` on `(hero_id, user_id)`), renaming a hero whose name the account
 * already uses; and its chosen display name, when the account's own is still the one made at sign-up. Guests have no
 * friends (friends need an account), so there is nothing else to move. Step 3 moves the cloud saves here too.
 */
export class GuestUpgrade {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  async move(guestId: string, userId: string): Promise<void> {
    if (guestId === userId) return;
    const moved = await this.db.transaction(async (tx) => {
      const taken = new Set(
        (
          await tx
            .select({ name: hero.name })
            .from(hero)
            .where(eq(hero.userId, userId))
        ).map((row) => row.name.toLowerCase()),
      );
      const heroes = await tx
        .select({ id: hero.id, name: hero.name })
        .from(hero)
        .where(eq(hero.userId, guestId));
      for (const { id, name } of heroes) {
        let free = name;
        for (let n = 2; taken.has(free.toLowerCase()); n++)
          free = `${name.slice(0, 20).trimEnd()} ${n}`;
        taken.add(free.toLowerCase());
        await tx
          .update(hero)
          .set({ userId, name: free, updatedAt: new Date() })
          .where(eq(hero.id, id));
      }

      const [guestProfile] = await tx
        .select()
        .from(profile)
        .where(eq(profile.userId, guestId))
        .limit(1);
      const [ownProfile] = await tx
        .select()
        .from(profile)
        .where(eq(profile.userId, userId))
        .limit(1);
      if (
        guestProfile?.nameChosen &&
        ownProfile !== undefined &&
        !ownProfile.nameChosen
      ) {
        // The guest's row goes first, so the name is free for the unique index.
        await tx.delete(profile).where(eq(profile.userId, guestId));
        await tx
          .update(profile)
          .set({
            displayName: guestProfile.displayName,
            nameChosen: true,
            updatedAt: new Date(),
          })
          .where(eq(profile.userId, userId));
      }
      return heroes.length;
    });
    this.logger.info('guest account upgraded', {
      guestId,
      userId,
      heroes: moved,
    });
  }
}
