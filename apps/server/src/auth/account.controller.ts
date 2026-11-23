import { SessionGuard } from '@dunx/auth';
import {
  Controller,
  Get,
  HttpStatusCode,
  Post,
  Public,
  UseGuards,
  type Input,
} from '@dunx/http';
import { DeleteAccount, type SignInMethod } from '@gravoth/contracts';
import { Accounts, type AccountView } from './accounts.service.js';
import { MarkPresence } from '../presence/presence.js';

const deleteAccount = {
  body: DeleteAccount,
  status: HttpStatusCode.OK,
} as const;

/**
 * The game's account routes (step 2). Sign-up, sign-in and sign-out are better-auth's,
 * under `/api/auth`: `sign-in/anonymous` (a guest), `sign-up/email`, `sign-in/email`,
 * `sign-in/social` (an OAuth provider), `request-password-reset`, `sign-out`. The
 * game sends the token from `set-auth-token` as `Authorization: Bearer <token>`.
 */
@UseGuards(SessionGuard, MarkPresence)
@Controller('account')
export class AccountController {
  constructor(private readonly accounts: Accounts) {}

  /** The SIGN IN row's view of the caller. */
  @Get('/')
  me(): Promise<AccountView> {
    return this.accounts.view();
  }

  /** Which sign-in buttons this server can honour, so the game shows no dead one. */
  @Public()
  @Get('/methods')
  methods(): { methods: readonly SignInMethod[] } {
    return { methods: this.accounts.methods() };
  }

  /**
   * Deletes the account (Google Play's account deletion requirement). A POST, since a
   * DELETE with a body is dropped by some clients, Unity's among them.
   */
  @Post('/delete', deleteAccount)
  async remove({
    body,
  }: Input<typeof deleteAccount>): Promise<{ deleted: true }> {
    await this.accounts.delete(body.password);
    return { deleted: true };
  }
}
