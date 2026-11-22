import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { REDACTED, redactSignInSecrets } from './http/log-redaction.js';
import { startTestApp, type TestApp } from './testing/app.js';

/**
 * A sign-in's one-time secrets stay out of the request lines (decision 224): the provider's `code` and the `state` on
 * better-auth's callback, and the game's handoff `code`, are replaced in the logged query and body, and nothing else
 * is (`statusCode`, other parameters, other routes).
 */
const line = (path: string, query: Record<string, string>, body?: unknown) => ({
  message: `GET ${path} 302`,
  event: path,
  request: { query, ...(body === undefined ? {} : { body }), userAgent: 'x' },
  statusCode: 302,
});

describe('redactSignInSecrets', () => {
  it("replaces a callback's code and state, and keeps everything else", () => {
    const entry = redactSignInSecrets(
      line('/api/auth/callback/google', {
        code: 'secret-code',
        state: 'secret-state',
        scope: 'openid',
      }),
      'info',
    );
    expect(entry).toEqual({
      message: 'GET /api/auth/callback/google 302',
      event: '/api/auth/callback/google',
      request: {
        query: { code: REDACTED, state: REDACTED, scope: 'openid' },
        userAgent: 'x',
      },
      statusCode: 302,
    });
  });

  it("covers the game's handoff, query and body, finding the path in the message without a context", () => {
    const { event: _event, ...noContext } = line(
      '/api/account/game-sign-in/exchange',
      { code: 'one-time' },
      { code: 'one-time', other: 1 },
    );
    expect(redactSignInSecrets(noContext, 'info')).toMatchObject({
      request: {
        query: { code: REDACTED },
        body: { code: REDACTED, other: 1 },
      },
    });
  });

  it("replaces the state in better-auth's own error line, keeping the error's code and message", () => {
    const thrown = Object.assign(new Error('State mismatch'), {
      code: 'state_mismatch',
      details: { state: 'secret-state' },
    });
    const entry = redactSignInSecrets(
      {
        message: '[better-auth] Failed to parse state',
        event: '/api/auth/callback/discord',
        details: [thrown],
        // As the logger hands a filter the line's error: already serialized, a plain object.
        error: {
          name: 'BetterAuthError',
          message: 'State mismatch',
          code: 'state_mismatch',
          details: { state: 'secret-state', at: new Date(0) },
        } as unknown as Error,
      },
      'error',
    );
    expect(entry).toMatchObject({
      details: [
        {
          name: 'Error',
          message: 'State mismatch',
          code: 'state_mismatch',
          details: { state: REDACTED },
        },
      ],
      error: {
        code: 'state_mismatch',
        details: { state: REDACTED, at: new Date(0) },
      },
    });
    // The thrown error itself is untouched.
    expect(thrown.details.state).toBe('secret-state');
  });

  it('leaves other routes, and a line with no request, alone', () => {
    const other = line('/api/leaderboards/pit_floor', { code: 'not-secret' });
    expect(redactSignInSecrets(structuredClone(other), 'info')).toEqual(other);
    expect(
      redactSignInSecrets(
        { message: 'database migrated', event: '/api/auth/callback/x' },
        'info',
      ),
    ).toEqual({ message: 'database migrated', event: '/api/auth/callback/x' });
  });
});

describe('the request lines of a running app', () => {
  let started: TestApp;
  const written: string[] = [];
  const spies: { mockRestore(): void }[] = [];

  beforeAll(async () => {
    for (const method of ['log', 'info', 'warn', 'error'] as const)
      spies.push(
        spyOn(console, method).mockImplementation((...args: unknown[]) => {
          written.push(args.map(String).join(' '));
        }),
      );
    started = await startTestApp({ config: { LOG_LEVEL: 'info' } });
  });

  afterAll(async () => {
    await started.close();
    for (const spy of spies) spy.mockRestore();
  });

  it('carry the route and its status, never the code or the state', async () => {
    const back = await fetch(
      `${started.base}/api/auth/callback/discord?code=PROVIDER-CODE-123&state=STATE-456&extra=kept-789`,
      { redirect: 'manual' },
    );
    expect(back.status).toBe(302);
    await fetch(
      `${started.base}/api/account/game-sign-in/done?code=HANDOFF-CODE-321`,
      { redirect: 'manual' },
    );
    await Bun.sleep(50);

    const callback = written.filter((text) =>
      text.includes('/api/auth/callback/discord'),
    );
    const done = written.filter((text) =>
      text.includes('/api/account/game-sign-in/done'),
    );
    expect(callback.length).toBeGreaterThan(0);
    expect(done.length).toBeGreaterThan(0);
    const all = written.join('\n');
    for (const secret of ['PROVIDER-CODE-123', 'STATE-456', 'HANDOFF-CODE-321'])
      expect(all).not.toContain(secret);
    const request = callback.join('\n');
    expect(request).toContain(REDACTED);
    expect(request).toContain('kept-789');
    expect(request).toContain('statusCode');
    expect(request).toContain('302');
  });
});
