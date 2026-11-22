/** `GET /api/meta`: the server's version, and the oldest game version it still serves. */
export interface MetaInfo {
  readonly service: 'gravoth';
  readonly version: string;
  readonly commit: string;
  readonly minGameVersion: string;
}

/** `GET /api/health`: always 200 while the process serves; the parts say whether Postgres and the rules checker answer. */
export interface HealthView {
  readonly status: 'ok';
  readonly uptimeSeconds: number;
  readonly database: 'up' | 'down';
  readonly validator: 'up' | 'down';
}

/**
 * The error codes the API answers with (the `message` of an error body), by
 * route. A client shows its own words for each; an unknown code is shown as
 * is.
 */
export const ERROR_CODES = [
  // Any route that needs a session.
  'UNAUTHENTICATED',
  'INVALID_CURSOR',
  // The account (POST /api/account/delete).
  'PASSWORD_REQUIRED',
  'INVALID_PASSWORD',
  // Profile (PATCH /api/profile).
  'NAME_FORMAT',
  'NAME_TAKEN',
  'NAME_NOT_ALLOWED',
  // Friends and blocks: a guest has neither.
  'GUEST_ACCOUNT',
  'PLAYER_NOT_FOUND',
  'CANNOT_FRIEND_SELF',
  'CANNOT_BLOCK_SELF',
  'ALREADY_FRIENDS',
  'ALREADY_REQUESTED',
  'PLAYER_BLOCKED',
  'REQUESTS_CLOSED',
  'REQUEST_NOT_FOUND',
  'FRIEND_NOT_FOUND',
  'BLOCK_NOT_FOUND',
  // Heroes and boards.
  'HERO_NAME_TAKEN',
  'HERO_NOT_FOUND',
  'BOARD_NOT_FOUND',
  'BUILD_NOT_FOUND',
  'BUILD_REVISION_TAKEN',
  'HARDCORE_MISMATCH',
  'SCORE_OUT_OF_RANGE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
