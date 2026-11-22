/** The game's way of calling the API in a test: JSON, a bearer token from `set-auth-token`, no cookies, no Origin. */
export interface Reply<T = Record<string, unknown>> {
  readonly status: number;
  readonly body: T;
  readonly token: string | null;
}

export const call = async <T = Record<string, unknown>>(
  base: string,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  options: { token?: string | undefined; body?: unknown } = {},
): Promise<Reply<T>> => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(options.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
      ...(options.token === undefined
        ? {}
        : { authorization: `Bearer ${options.token}` }),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text === '' ? {} : JSON.parse(text)) as T,
    token: response.headers.get('set-auth-token'),
  };
};

export interface Player {
  readonly token: string;
  readonly id: string;
  readonly displayName: string;
}

/** A new email-and-password account, and its profile's display name. */
export const signUp = async (
  base: string,
  name: string,
  email: string,
  password = 'a long enough password',
): Promise<Player> => {
  const reply = await call<{ user: { id: string } }>(
    base,
    'POST',
    '/api/auth/sign-up/email',
    { body: { name, email, password } },
  );
  if (reply.status !== 200 || reply.token === null)
    throw new Error(
      `sign-up ${email} answered ${reply.status}: ${JSON.stringify(reply.body)}`,
    );
  const profile = await call<{ displayName: string }>(
    base,
    'GET',
    '/api/profile',
    { token: reply.token },
  );
  return {
    token: reply.token,
    id: reply.body.user.id,
    displayName: profile.body.displayName,
  };
};

/** A new guest account. */
export const guest = async (base: string): Promise<Player> => {
  const reply = await call<{ user: { id: string } }>(
    base,
    'POST',
    '/api/auth/sign-in/anonymous',
    { body: {} },
  );
  if (reply.status !== 200 || reply.token === null)
    throw new Error(`guest sign-in answered ${reply.status}`);
  const profile = await call<{ displayName: string }>(
    base,
    'GET',
    '/api/profile',
    { token: reply.token },
  );
  return {
    token: reply.token,
    id: reply.body.user.id,
    displayName: profile.body.displayName,
  };
};
