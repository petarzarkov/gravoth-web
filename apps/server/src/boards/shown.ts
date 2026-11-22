import { and, eq, ne, type SQL } from 'drizzle-orm';
import { hero, leaderboardEntry } from '../database/schema.js';

/**
 * Which board entries show, wherever one is read (the boards, a player page's records): never a flagged one, and
 * only an online hero's that the rules checker has not flagged (decision 227: "Once you go online, there's no local").
 * An offline hero's entries (v0.13.0's score route) are kept but never shown. A query using it joins `heroes` on the
 * entry's hero.
 */
export const shownEntry = (): SQL =>
  and(
    ne(leaderboardEntry.verdict, 'flagged'),
    eq(hero.online, true),
    eq(hero.flagged, false),
  ) as SQL;
