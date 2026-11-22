import { and, ne, type SQL } from 'drizzle-orm';
import { leaderboardEntry } from '../database/schema.js';

/**
 * Which board entries show, wherever one is read (the boards, a player page's records): never a flagged one. A query
 * using it joins `heroes` on the entry's hero.
 */
export const shownEntry = (): SQL =>
  and(ne(leaderboardEntry.verdict, 'flagged')) as SQL;
