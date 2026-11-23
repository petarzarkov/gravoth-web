import { z } from 'zod';
import { AvatarChoice, type AvatarView } from './avatar.js';
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
    /** `provider`: the sign-in's own photo (409 `NO_PROVIDER_PHOTO` without one); else a portrait's id. */
    avatar: AvatarChoice.optional(),
  })
  .meta({
    id: 'UpdateProfile',
    description:
      "The caller's display name, picture and privacy flags; what is left out stays as it is",
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
  /** The picture others see. */
  readonly avatar: AvatarView;
  /** The sign-in has a photo (Google or Discord), so "use my photo" can be offered. */
  readonly hasProviderPhoto: boolean;
}

export interface FriendView {
  readonly userId: string;
  readonly displayName: string;
  readonly avatar: AvatarView;
  /** When the request was accepted. */
  readonly since: string;
}

export type RequestDirection = 'incoming' | 'outgoing';

export interface RequestView {
  readonly id: string;
  /** The other player. */
  readonly userId: string;
  readonly displayName: string;
  readonly avatar: AvatarView;
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

/**
 * Why a player is suggested (decision 229): `mutual`, friends with `count` of the caller's friends; `board`, within
 * five places of the caller's best on that board (`boardId` is its key as `/api/leaderboards/:key` takes it, `hc_` for
 * the hardcore twin; the closest board only); `chat`, wrote in Global within 30 minutes of one of the caller's messages
 * in the last 7 days; `active`, played in the last 7 days (only to fill a list the others leave short).
 */
export type SuggestionReason =
  | { readonly kind: 'mutual'; readonly count: number }
  | {
      readonly kind: 'board';
      readonly boardId: string;
      readonly boardTitle: string;
      readonly yourRank: number;
      readonly theirRank: number;
    }
  | { readonly kind: 'chat' }
  | { readonly kind: 'active' };

export interface SuggestionView {
  readonly userId: string;
  readonly displayName: string;
  readonly avatar: AvatarView;
  /** Strongest first. */
  readonly reasons: readonly SuggestionReason[];
  /** One display line the server writes from the reasons, e.g. "2 mutual friends · Near you on Bone Pit". Clients show it as is, so a new source needs no client update. */
  readonly note: string;
}

/** `GET /api/friends/suggestions`: at most 20, the best first. */
export interface SuggestionList {
  readonly items: readonly SuggestionView[];
}
