import {
  Controller,
  Get,
  Post,
  Public,
  type Input,
  type RouteSchemas,
} from '@dunx/http';
import { z } from 'zod';
import { escapeHtml } from '../http/escape-html.js';
import { Accounts } from './accounts.service.js';

const withToken = {
  query: z.object({ token: z.string().max(512).optional() }),
} as const;
const withError = {
  query: z.object({ error: z.string().max(64).optional() }),
} as const;

/**
 * The two pages a mail link opens in the player's browser: choose a new password, and
 * "your address is confirmed". Plain HTML forms, no script, so they work in any mail
 * app's browser. They live on the API until the website has pages of its own.
 */
@Public()
@Controller('account')
export class AccountPagesController {
  constructor(private readonly accounts: Accounts) {}

  @Get('/reset-password', withToken)
  resetForm({ query }: Input<typeof withToken>): Response {
    if (!query.token)
      return page('Link incomplete', [
        'This reset link is missing its code. Ask for a new one in the game.',
      ]);
    return page(
      'Choose a new password',
      [],
      `
      <form method="post" action="reset-password">
        <input type="hidden" name="token" value="${escapeHtml(query.token)}">
        <label>New password<br><input type="password" name="newPassword" minlength="8" maxlength="128" required autocomplete="new-password"></label>
        <button type="submit">Save</button>
      </form>`,
    );
  }

  @Post('/reset-password')
  async reset({ req }: Input<RouteSchemas>): Promise<Response> {
    const form = await req.formData().catch(() => undefined);
    const field = (name: string): string => {
      const value = form?.get(name);
      return typeof value === 'string' ? value : '';
    };
    const token = field('token');
    const password = field('newPassword');
    if (token === '')
      return page(
        'Link incomplete',
        ['This reset link is missing its code. Ask for a new one in the game.'],
        '',
        400,
      );
    const outcome = await this.accounts.resetPassword(token, password);
    switch (outcome) {
      case 'done':
        return page('Password changed', [
          'Sign in with your new password in Gravoth. Every other device was signed out.',
        ]);
      case 'too-short':
      case 'too-long':
        return page(
          'Choose a new password',
          ['The password needs 8 to 128 characters.'],
          `
          <p><a href="reset-password?token=${encodeURIComponent(token)}">Try again</a></p>`,
          400,
        );
      case 'expired':
        return page(
          'Link expired',
          [
            'This reset link was used or is over an hour old. Ask for a new one in the game.',
          ],
          '',
          400,
        );
    }
  }

  /** Where better-auth's `verify-email` sends the browser, with `?error=` when the link failed. */
  @Get('/email-verified', withError)
  emailVerified({ query }: Input<typeof withError>): Response {
    return query.error
      ? page(
          'Link expired',
          [
            'This confirmation link was used or is over an hour old. Ask for a new one in the game.',
          ],
          '',
          400,
        )
      : page('Address confirmed', [
          "Your Gravoth account's address is confirmed. You can close this page and return to the game.",
        ]);
  }
}

export const page = (
  title: string,
  lines: readonly string[],
  extra = '',
  status = 200,
): Response =>
  new Response(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)} - Gravoth</title>
<style>body{font-family:system-ui,sans-serif;background:#16130f;color:#e8dcc4;max-width:28rem;margin:3rem auto;padding:0 1rem}
h1{font-size:1.4rem;color:#d9b56a}input{width:100%;padding:.5rem;margin:.4rem 0 1rem;box-sizing:border-box}
button{padding:.5rem 1.2rem}a{color:#d9b56a}</style></head>
<body><h1>${escapeHtml(title)}</h1>${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}${extra}</body></html>`,
    {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        // The token is in the URL: never hand it to another site.
        'referrer-policy': 'no-referrer',
      },
    },
  );
