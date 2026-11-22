import { symmetricEncrypt } from 'better-auth/crypto';

/**
 * What an `accounts` row keeps of a Google or Discord sign-in's tokens (decision 224). The server never calls a
 * provider with them, so none is kept readable:
 *
 * - the access and refresh tokens are encrypted with `AUTH_SECRET` (better-auth's `account.encryptOAuthTokens`, and
 *   here too, for the one route of better-auth 1.6.25 that writes them as they came: linking a provider by ID token);
 * - the ID token is not kept at all. better-auth 1.6.25 never encrypts it (and nothing here reads it back), and it is
 *   the provider's signed statement of the player's name, address and photo.
 *
 * better-auth reads a token that does not look encrypted as it is, so a row from before this (cleared by migration
 * 0004) never fails a read.
 */
const TOKENS = ['accessToken', 'refreshToken'] as const;

/** better-auth's own test of an encrypted token (`oauth2/utils.mjs`): its envelope, or bare even-length hex. */
export const looksEncrypted = (token: string): boolean =>
  token.startsWith('$ba$') ||
  (token.length % 2 === 0 && /^[0-9a-f]+$/i.test(token));

/** The row (or the fields of an update) as it may be written: tokens encrypted, no ID token. */
export const sealAccountTokens = async <T extends Record<string, unknown>>(
  row: T,
  secret: string,
): Promise<T> => {
  const sealed: Record<string, unknown> = { ...row };
  if ('idToken' in sealed && sealed['idToken'] !== undefined)
    sealed['idToken'] = null;
  for (const field of TOKENS) {
    const token = sealed[field];
    if (typeof token === 'string' && token !== '' && !looksEncrypted(token))
      sealed[field] = await symmetricEncrypt({ key: secret, data: token });
  }
  return sealed as T;
};
