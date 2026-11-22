import { z } from 'zod';
import { SOCIAL_PROVIDERS, type SignInMethod } from './constants.js';

/** `GET /api/account/methods`: which sign-in buttons this server can honour, so a client shows no dead one. */
export interface SignInMethods {
  readonly methods: readonly SignInMethod[];
}

/** `GET /api/account`. */
export interface AccountView {
  readonly id: string;
  readonly name: string;
  /** Null for a guest: their stored address is a placeholder nobody reads. */
  readonly email: string | null;
  readonly emailVerified: boolean;
  /** A guest account: no way back in but this device's token, until it signs up. */
  readonly guest: boolean;
  /** How this account can sign in: `email` for a password, else the provider. */
  readonly signIn: readonly SignInMethod[];
  readonly createdAt: string;
  /** Holds the `admin` role (decision 228's moderation: the website's /admin/chat). */
  readonly admin: boolean;
}

/** `POST /api/account/delete`. */
export const DeleteAccount = z
  .object({
    /** Required when the account has a password; a guest or provider-only account sends none. */
    password: z.string().max(128).optional(),
  })
  .meta({
    id: 'DeleteAccount',
    description: "Delete the caller's account and everything kept for it",
  });

export type DeleteAccount = z.infer<typeof DeleteAccount>;

/** What `get-session` answers for a signed-in caller (the fields a client reads). */
export interface SessionView {
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly emailVerified: boolean;
    readonly isAnonymous?: boolean | null;
  };
  readonly session: { readonly id: string; readonly expiresAt: string };
}

/**
 * The game's browser sign-in (Google, Discord): the game opens the system browser at
 * `GET /api/account/game-sign-in` with these, the player signs in at the provider, and
 * the server sends the browser back to `return` with a one-time `code` and the same
 * `state`. `return` is the phone's `gravoth://auth` or a loopback address the game
 * listens on (`http://127.0.0.1:<port>/<path>`, the Editor and PC).
 */
export const GameSignInStart = z
  .object({
    provider: z.enum(SOCIAL_PROVIDERS),
    return: z.string().min(1).max(200),
    /** The game's own random value, handed back unchanged so it knows the answer is to its request. */
    state: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  })
  .meta({
    id: 'GameSignInStart',
    description: "Start a game's sign-in with a provider in the browser",
  });

export type GameSignInStart = z.infer<typeof GameSignInStart>;

/** `POST /api/account/game-sign-in/exchange`: the one-time code (two minutes, once) for a session. */
export const GameSignInExchange = z
  .object({ code: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/) })
  .meta({
    id: 'GameSignInExchange',
    description: 'Trade the one-time code from a browser sign-in for a session',
  });

export type GameSignInExchange = z.infer<typeof GameSignInExchange>;

/** What the exchange answers: the session token the game sends as `Authorization: Bearer <token>`. */
export interface GameSignInToken {
  readonly token: string;
}
