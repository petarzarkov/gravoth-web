import { z } from 'zod';
import { DISPLAY_NAME_PATTERN, DISPLAY_NAME_RULE } from './constants.js';

export const DisplayName = z
  .string()
  .regex(DISPLAY_NAME_PATTERN, DISPLAY_NAME_RULE);

/** `PATCH /api/profile`: what is left out stays as it is. */
export const UpdateProfile = z
  .object({
    displayName: DisplayName.optional(),
    publicProfile: z.boolean().optional(),
    allowFriendRequests: z.boolean().optional(),
    showOnline: z.boolean().optional(),
    emailFriendRequests: z.boolean().optional(),
  })
  .meta({
    id: 'UpdateProfile',
    description:
      "The caller's display name and privacy flags; what is left out stays as it is",
  });

/** A player, by display name (any case): a friend request or a block. */
export const ToPlayer = z.object({ displayName: DisplayName }).meta({
  id: 'ToPlayer',
  description: 'A player, by display name (any case)',
});

export const RequestId = z.object({ id: z.uuid() });
export const PlayerId = z.object({ userId: z.uuid() });

export type UpdateProfile = z.infer<typeof UpdateProfile>;
export type ToPlayer = z.infer<typeof ToPlayer>;

/** The profile as its owner sees it (`GET /api/profile`). */
export interface ProfileView {
  readonly userId: string;
  readonly displayName: string;
  /** False until the player picks a name of their own (the first one is made from the sign-in's). */
  readonly nameChosen: boolean;
  readonly publicProfile: boolean;
  readonly allowFriendRequests: boolean;
  readonly showOnline: boolean;
  readonly emailFriendRequests: boolean;
}

export interface FriendView {
  readonly userId: string;
  readonly displayName: string;
  /** When the request was accepted. */
  readonly since: string;
}

export type RequestDirection = 'incoming' | 'outgoing';

export interface RequestView {
  readonly id: string;
  /** The other player. */
  readonly userId: string;
  readonly displayName: string;
  readonly direction: RequestDirection;
  readonly createdAt: string;
}

/** `POST /api/friends/requests`. */
export type RequestOutcome =
  | { readonly status: 'pending'; readonly request: RequestView }
  /** They had already asked the caller, so asking back accepts theirs. */
  | { readonly status: 'accepted'; readonly friend: FriendView };

export interface BlockView {
  readonly userId: string;
  readonly displayName: string;
  readonly blockedAt: string;
}
