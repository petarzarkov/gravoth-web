import { z } from 'zod';

/** The third-party sign-ins, each offered only while the server has its client. */
export const SOCIAL_PROVIDERS = ['google', 'discord'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

/** A sign-in method a client can offer, as `GET /api/account/methods` lists it. */
export type SignInMethod = 'guest' | 'email' | SocialProvider;

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

/** better-auth's limits on a password (`emailAndPassword` in the server's auth module). */
export const PASSWORD_LIMITS = { min: 8, max: 128 } as const;

/** better-auth's routes, under `/api/auth`, that a browser client calls. */
export const AUTH_ROUTES = {
  session: '/api/auth/get-session',
  signInEmail: '/api/auth/sign-in/email',
  signUpEmail: '/api/auth/sign-up/email',
  signInSocial: '/api/auth/sign-in/social',
  signOut: '/api/auth/sign-out',
  requestPasswordReset: '/api/auth/request-password-reset',
  resetPassword: '/api/auth/reset-password',
  sendVerificationEmail: '/api/auth/send-verification-email',
} as const;

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
