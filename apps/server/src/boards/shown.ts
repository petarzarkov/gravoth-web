import { and, eq, ne, type SQL } from 'drizzle-orm';
import { hero, leaderboardEntry } from '../database/schema.js';

/**
 * Which board entries show, wherever one is read (the boards, a player page's records): never a flagged one, never a
 * hero the rules checker flagged, and with `onlineOnly` (BOARDS_ONLINE_ONLY, decision 227: "Once you go online, there's
 * no local") only an online hero's: an offline hero's entries (v0.13.0's score route) are then kept but never shown.
 * A query using it joins `heroes` on the entry's hero.
 */
export const shownEntry = (onlineOnly: boolean): SQL =>
  (onlineOnly
    ? and(
        ne(leaderboardEntry.verdict, 'flagged'),
        eq(hero.online, true),
        eq(hero.flagged, false),
      )
    : and(
        ne(leaderboardEntry.verdict, 'flagged'),
        eq(hero.flagged, false),
      )) as SQL;
