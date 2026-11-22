import { Auth } from '@dunx/auth';
import { Logger } from '@dunx/core';
import { HttpError, HttpStatusCode } from '@dunx/http';
import type { GameSignInStart, GameSignInToken } from '@gravoth/contracts';
import { AppConfigService } from '../config.js';
import { escapeHtml } from '../http/escape-html.js';
import { GuestUpgrade } from '../players/guest-upgrade.js';
import { page } from './account-pages.controller.js';

/** How long the one-time code from a browser sign-in can be traded for a session. */
export const GAME_CODE_TTL_MS = 120_000;
const CODE_PREFIX = 'game-sign-in:';
const PHONE_RETURN = 'gravoth://auth';

/**
 * Where a game's browser sign-in may come back to: the phone's `gravoth://auth` link, or a loopback address on the
 * player's own machine (the Editor and PC listen on `http://127.0.0.1:<port>/<path>`). Anything else is refused, so the
 * one-time code can never be sent to another site.
 */
export const isGameReturn = (uri: string): boolean => {
  if (uri === PHONE_RETURN) return true;
  const url = URL.parse(uri);
  return (
    url !== null &&
    url.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
    url.port !== '' &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === ''
  );
};

/** A provider's error as better-auth hands it back (`?error=...`), kept to a safe word. */
const errorWord = (error: string | undefined): string =>
  (error ?? '').replace(/[^a-z_]/gi, '').slice(0, 64) || 'sign_in_failed';

/** The caller's address and browser, for the session's record and better-auth's rate limit. */
const forwarded = (req: Request): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const name of ['user-agent', 'cf-connecting-ip', 'x-forwarded-for']) {
    const value = req.headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
};

/**
 * The game's sign-in with Google or Discord, through the system browser (decision 221): one flow on every platform,
 * with no native plugin.
 *
 * 1. `start`: the game opens the browser here. This starts better-auth's own provider sign-in (the state cookie, PKCE)
 *    and sends the browser on to the provider, asking to come back to `done`.
 * 2. `done`: better-auth has signed the browser in. That session is traded for a one-time code (two minutes, once),
 *    the browser's session is ended (it was only the way here), and the browser goes back to the game: a redirect to
 *    the loopback address, or a page that opens `gravoth://auth` on a phone.
 * 3. `exchange`: the game trades the code for a session of its own. A guest who signs in this way becomes that
 *    account, its heroes moved first, as in the website's sign-in.
 */
export class GameSignIn {
  constructor(
    private readonly auth: Auth,
    private readonly config: AppConfigService,
    private readonly upgrade: GuestUpgrade,
    private readonly logger: Logger,
  ) {}

  async start(query: GameSignInStart, req: Request): Promise<Response> {
    if (!isGameReturn(query.return))
      throw new HttpError(HttpStatusCode.BAD_REQUEST, 'RETURN_NOT_ALLOWED');
    const publicUrl = this.config.get('publicUrl');
    const back = `${publicUrl}/api/account/game-sign-in/done?${new URLSearchParams(
      { return: query.return, state: query.state },
    ).toString()}`;
    const answer = await this.auth.handler(
      new Request(`${publicUrl}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: publicUrl,
          ...forwarded(req),
        },
        body: JSON.stringify({
          provider: query.provider,
          callbackURL: back,
          errorCallbackURL: back,
          disableRedirect: true,
        }),
      }),
    );
    const body = (await answer.json().catch(() => ({}))) as { url?: string };
    if (!answer.ok || typeof body.url !== 'string') {
      this.logger.warn('game sign-in could not start', {
        provider: query.provider,
        status: answer.status,
      });
      return page(
        'Sign-in unavailable',
        [
          'This sign-in cannot start right now. Go back to Gravoth and try again later.',
        ],
        '',
        502,
      );
    }
    const headers = new Headers({
      location: body.url,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    });
    for (const cookie of answer.headers.getSetCookie())
      headers.append('set-cookie', cookie);
    return new Response(null, { status: 302, headers });
  }

  async done(
    query: { return: string; state: string; error?: string | undefined },
    req: Request,
  ): Promise<Response> {
    if (!isGameReturn(query.return))
      throw new HttpError(HttpStatusCode.BAD_REQUEST, 'RETURN_NOT_ALLOWED');
    if (query.error !== undefined)
      return this.handBack(query.return, {
        error: errorWord(query.error),
        state: query.state,
      });
    const session = await this.auth.api.getSession({ headers: req.headers });
    if (session === null)
      return this.handBack(query.return, {
        error: 'no_session',
        state: query.state,
      });

    const context = await this.auth.$context;
    const code = Buffer.from(
      crypto.getRandomValues(new Uint8Array(32)),
    ).toString('base64url');
    await context.internalAdapter.createVerificationValue({
      identifier: CODE_PREFIX + code,
      value: session.user.id,
      expiresAt: new Date(Date.now() + GAME_CODE_TTL_MS),
    });
    // The browser's session was only the way here: end it, so the browser keeps no sign-in the player never asked for.
    await context.internalAdapter.deleteSession(session.session.token);
    const cookie = context.authCookies.sessionToken;
    const clear = `${cookie.name}=; Max-Age=0; Path=${cookie.attributes.path ?? '/'}; HttpOnly; SameSite=Lax${cookie.attributes.secure === true ? '; Secure' : ''}`;
    return this.handBack(query.return, { code, state: query.state }, clear);
  }

  async exchange(code: string, req: Request): Promise<GameSignInToken> {
    const context = await this.auth.$context;
    const row = await context.internalAdapter.consumeVerificationValue(
      CODE_PREFIX + code,
    );
    if (row === null)
      throw new HttpError(HttpStatusCode.BAD_REQUEST, 'CODE_INVALID');
    const userId = row.value;

    // A guest who signs in this way becomes that account (as `anonymous`'s onLinkAccount does for the website).
    if (req.headers.get('authorization') !== null) {
      const caller = await this.auth.api.getSession({ headers: req.headers });
      const guest =
        (caller?.user as { isAnonymous?: boolean | null } | undefined)
          ?.isAnonymous === true;
      if (caller !== null && guest && caller.user.id !== userId) {
        await this.upgrade.move(caller.user.id, userId);
        await context.internalAdapter.deleteUser(caller.user.id);
      }
    }

    const session = await context.internalAdapter.createSession(userId, false, {
      ipAddress:
        req.headers.get('cf-connecting-ip') ??
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        null,
      userAgent: req.headers.get('user-agent'),
    });
    this.logger.info('game signed in through the browser', { userId });
    return { token: session.token };
  }

  /** Back to the game: a redirect to a loopback address, or a page that opens the phone's `gravoth://auth`. */
  private handBack(
    to: string,
    params: Record<string, string>,
    clearCookie?: string,
  ): Response {
    const target = `${to}?${new URLSearchParams(params).toString()}`;
    const headers = new Headers({
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    });
    if (clearCookie !== undefined) headers.append('set-cookie', clearCookie);
    if (to !== PHONE_RETURN) {
      headers.set('location', target);
      return new Response(null, { status: 302, headers });
    }
    const ok = params['code'] !== undefined;
    const reply = page(
      ok ? 'Signed in' : 'Sign-in stopped',
      [
        ok
          ? 'Returning to Gravoth. If nothing happens, tap the button.'
          : 'Return to Gravoth and try again.',
      ],
      `<meta http-equiv="refresh" content="0;url=${escapeHtml(target)}"><p><a href="${escapeHtml(target)}"><button type="button">Return to Gravoth</button></a></p>`,
    );
    reply.headers.forEach((value, name) => {
      if (!headers.has(name)) headers.set(name, value);
    });
    return new Response(reply.body, { status: 200, headers });
  }
}
