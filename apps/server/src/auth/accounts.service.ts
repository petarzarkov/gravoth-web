import { Auth, AuthContext } from '@dunx/auth';
import { HttpError, HttpStatusCode } from '@dunx/http';
import { Mailer } from '../mail/mailer.js';
import { SignInProviders, type SignInMethod } from './sign-in-providers.js';
import type { AccountView } from '@gravoth/contracts';
export type { AccountView };

/** better-auth's provider id for a password. */
const CREDENTIAL = 'credential';

/**
 * The game's view of the caller's account, and the deletion Google Play requires of a
 * game that makes accounts. The caller is the one `SessionGuard` established.
 */
export class Accounts {
  constructor(
    private readonly auth: Auth,
    private readonly caller: AuthContext,
    private readonly providers: SignInProviders,
    private readonly mail: Mailer,
  ) {}

  methods(): readonly SignInMethod[] {
    return this.providers.methods();
  }

  async view(): Promise<AccountView> {
    const { user } = this.caller.require();
    const context = await this.auth.$context;
    const linked = await context.internalAdapter.findAccounts(user.id);
    const guest =
      (user as { isAnonymous?: boolean | null }).isAnonymous === true;
    return {
      id: user.id,
      name: user.name,
      email: Mailer.isPlaceholder(user.email) ? null : user.email,
      emailVerified: user.emailVerified,
      guest,
      signIn: linked
        .map(
          (account) =>
            (account.providerId === CREDENTIAL
              ? 'email'
              : account.providerId) as SignInMethod,
        )
        .sort(),
      createdAt: new Date(user.createdAt).toISOString(),
    };
  }

  /**
   * Deletes the caller's account: one `DELETE` of the user row, and the foreign keys take everything kept for it with
   * it (its sign-ins and sessions, its profile, heroes, builds and board entries, its friendships, requests and blocks
   * either way). An account with a password has to give it; a guest or a Google- or Discord-only account is proven by
   * its session, the same one that signs it in. A confirmed address then gets one last mail saying so.
   */
  async delete(password: string | undefined): Promise<void> {
    const { user } = this.caller.require();
    const context = await this.auth.$context;
    const credential = (
      await context.internalAdapter.findAccounts(user.id)
    ).find((account) => account.providerId === CREDENTIAL && account.password);
    if (credential?.password) {
      if (password === undefined || password === '') {
        throw new HttpError(HttpStatusCode.BAD_REQUEST, 'PASSWORD_REQUIRED');
      }
      if (
        !(await context.password.verify({
          hash: credential.password,
          password,
        }))
      ) {
        throw new HttpError(HttpStatusCode.FORBIDDEN, 'INVALID_PASSWORD');
      }
    }
    await context.internalAdapter.deleteUserSessions(user.id);
    await context.internalAdapter.deleteUser(user.id);
    if (user.emailVerified)
      await this.mail.accountDeleted(user.email, user.name);
  }

  /** The reset page's form: `done`, or why the new password was refused. */
  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<'done' | 'expired' | 'too-short' | 'too-long'> {
    const context = await this.auth.$context;
    const { minPasswordLength, maxPasswordLength } = context.password.config;
    if (newPassword.length < minPasswordLength) return 'too-short';
    if (newPassword.length > maxPasswordLength) return 'too-long';
    try {
      await this.auth.api.resetPassword({ body: { token, newPassword } });
      return 'done';
    } catch {
      return 'expired';
    }
  }
}
