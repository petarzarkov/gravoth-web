import type { LogFilter } from '@dunx/infra/logger';

/**
 * The sign-in routes whose lines can carry a one-time secret: a provider's authorization `code` and the `state` that
 * binds it to the browser on better-auth's callback (`/api/auth/callback/<provider>`; better-auth's own error line
 * there repeats the state in its details), and the game's browser sign-in (`/api/account/game-sign-in`, whose `/done`
 * and `/exchange` handle the game's own one-time `code`).
 */
const SIGN_IN_PATHS = ['/api/auth/callback/', '/api/account/game-sign-in'];
export const REDACTED = '[redacted]';
const MAX_DEPTH = 8;

/** The request's path, from the line's context (`event`) or its message (`GET /api/auth/callback/google 302`). */
const pathOf = (entry: Record<string, unknown>): string | undefined => {
  const event = entry['event'];
  if (typeof event === 'string') return event;
  const message = entry['message'];
  return typeof message === 'string' ? message.split(' ')[1] : undefined;
};

const isPlain = (value: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** An error, thrown or already serialized: its own `code` (`state_mismatch`) names the failure and is kept. */
const isError = (value: object): boolean =>
  value instanceof Error ||
  (typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { message?: unknown }).message === 'string');

/** A copy with every `state`, and every `code` that is not an error's own, replaced; anything else as it was. */
const scrub = (value: unknown, depth: number): unknown => {
  if (depth > MAX_DEPTH || typeof value !== 'object' || value === null)
    return value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  if (!(value instanceof Error) && !isPlain(value)) return value;
  const error = isError(value);
  // A thrown error's name, message and stack are not its own enumerable fields; the copy keeps them.
  const fields: Record<string, unknown> =
    value instanceof Error
      ? {
          ...{ name: value.name, message: value.message, stack: value.stack },
          ...(value as unknown as Record<string, unknown>),
        }
      : (value as Record<string, unknown>);
  return Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [
      key,
      key === 'state' || (key === 'code' && !error)
        ? REDACTED
        : scrub(field, depth + 1),
    ]),
  );
};

/**
 * A log filter (`@arkv/logger`'s `filters`, run before its key-name masking): on a sign-in route's lines, the `code`
 * and `state` wherever they appear (the logged query and body, an error's details) are replaced. Only those exact
 * keys, and only there: the logger's own masking matches a key by substring, so masking `code` everywhere would also
 * blank every line's `statusCode`.
 */
export const redactSignInSecrets: LogFilter = (entry) => {
  const path = pathOf(entry);
  if (path === undefined || !SIGN_IN_PATHS.some((p) => path.startsWith(p)))
    return entry;
  for (const [key, value] of Object.entries(entry))
    if (typeof value === 'object' && value !== null)
      entry[key] = scrub(value, 0);
  return entry;
};
