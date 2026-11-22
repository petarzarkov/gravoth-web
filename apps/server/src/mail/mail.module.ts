import { Module } from '@dunx/core';
import { EmailModule } from '@dunx/infra/email';
import { ReactEmailRenderer } from '@dunx/infra/email/react';
import { ResendTransport } from '@dunx/infra/email/resend';
import { AppConfigService } from '../config.js';
import { Mailer } from './mailer.js';

/**
 * Mail through Resend (`@dunx/infra/email/resend`), from `MAIL_FROM` (Gravoth <no-reply@mail.petarzarkov.com>), the
 * bodies rendered from the React Email templates (`@dunx/infra/email/react`). With no `RESEND_API_KEY` there is no
 * transport, so the module's log transport writes each mail it would have sent (its body only at debug, since a link
 * in it is a credential).
 */
@Module({
  imports: [
    EmailModule.forRootAsync({
      useFactory: (config: AppConfigService) => {
        const { resendApiKey, from } = config.get('mail');
        return {
          ...(resendApiKey === undefined ? {} : { transport: new ResendTransport({ apiKey: resendApiKey }) }),
          renderer: new ReactEmailRenderer(),
          from,
          // Resend's default limit is two requests a second.
          maxPerSecond: 2,
          resilience: { timeoutMs: 15_000 },
        };
      },
      inject: [AppConfigService] as const,
    }),
  ],
  providers: [Mailer],
  exports: [Mailer],
})
export class MailModule {}
