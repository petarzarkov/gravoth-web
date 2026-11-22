import { GAME_CLIENT_HEADER } from '@gravoth/contracts';

/**
 * Decision 223: the game's session lasts until the player signs out (or deletes the account). A session made for the
 * game (its calls carry `x-gravoth-client: game/<version>`, and the browser sign-in's exchange) expires in 50 years;
 * better-auth's sliding renewal only ever pushes an expiry later, so it never shortens one. The website's cookie
 * sessions keep `AUTH_SESSION_DAYS`.
 */
export const GAME_SESSION_MS = 50 * 365 * 86_400_000;

export const gameSessionExpiry = (): Date =>
  new Date(Date.now() + GAME_SESSION_MS);

/** Whether these request headers are the game's. */
export const isGameClient = (headers: Headers | null | undefined): boolean =>
  (headers?.get(GAME_CLIENT_HEADER) ?? '').startsWith('game');
