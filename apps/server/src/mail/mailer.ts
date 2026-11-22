import { Logger } from '@dunx/core';
import { EmailService } from '@dunx/infra/email';
import AccountDeleted from './templates/account-deleted.js';
import FriendRequest from './templates/friend-request.js';
import ResetPassword from './templates/reset-password.js';
import VerifyEmail from './templates/verify-email.js';

/**
 * Every mail the server sends, each one a React Email template in templates/ (`bun run mail:preview` shows them):
 * confirm the address, reset the password, the account is deleted, a friend request.
 *
 * Guests carry a made-up address under the reserved `.invalid` top-level domain (RFC 2606), so better-auth's unique,
 * non-null email column has a value; nothing is ever sent to one. A mail that fails is logged, not thrown: what it
 * belongs to (a sign-up, a deletion) has already happened, and the player can ask for an account mail again.
 */
export class Mailer {
  constructor(
    private readonly email: EmailService,
    private readonly logger: Logger,
  ) {}

  /** True for an address no mail may go to. */
  static isPlaceholder(address: string): boolean {
    return address.toLowerCase().endsWith('.invalid');
  }

  verification(to: string, name: string, url: string): Promise<void> {
    return this.send(to, VerifyEmail.subject, VerifyEmail, { name, url });
  }

  passwordReset(to: string, name: string, url: string): Promise<void> {
    return this.send(to, ResetPassword.subject, ResetPassword, { name, url });
  }

  accountDeleted(to: string, name: string): Promise<void> {
    return this.send(to, AccountDeleted.subject, AccountDeleted, { name });
  }

  friendRequest(to: string, name: string, from: string): Promise<void> {
    return this.send(to, FriendRequest.subject(from), FriendRequest, {
      name,
      from,
    });
  }

  private async send(
    to: string,
    subject: string,
    template: unknown,
    props: Record<string, unknown>,
  ): Promise<void> {
    if (Mailer.isPlaceholder(to)) {
      this.logger.info('mail skipped: the account has no real address', {
        subject,
      });
      return;
    }
    try {
      await this.email.sendTemplate({ to, subject, template, props });
    } catch (error) {
      this.logger.error('mail not sent', { subject, err: error });
    }
  }
}
