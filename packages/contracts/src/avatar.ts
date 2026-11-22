import { z } from 'zod';
import { AVATAR_PORTRAITS, type AvatarPortrait } from './constants.js';

/** A player's picture: their Google or Discord photo (`provider`), or one of Gravoth's portraits. */
export interface AvatarView {
  readonly kind: 'provider' | 'portrait';
  /** The portrait's id. For `provider` too: the portrait to show when the photo cannot load. */
  readonly portrait: AvatarPortrait;
  /** The provider photo's address for `provider`; null for `portrait`. */
  readonly url: string | null;
}

/** What `PATCH /api/profile` may set the picture to: the sign-in's photo (`provider`), or a portrait by id. */
export const AvatarChoice = z.enum(['provider', ...AVATAR_PORTRAITS]);
export type AvatarChoice = z.infer<typeof AvatarChoice>;
