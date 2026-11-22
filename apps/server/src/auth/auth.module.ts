import { Auth, AuthContext, AuthModule, bunPassword, SessionGuard } from '@dunx/auth';
import { drizzleDatabase } from '@dunx/auth/drizzle';
import { Logger, Module } from '@dunx/core';
import { DbConnection } from '@dunx/infra/db';
import { admin, anonymous, bearer, openAPI } from 'better-auth/plugins';
import { AppConfigService } from '../config.js';
import { DatabaseModule } from '../database/database.module.js';
import { MailModule } from '../mail/mail.module.js';
import { Mailer } from '../mail/mailer.js';
import { GuestUpgrade } from '../players/guest-upgrade.js';
import { PlayersModule } from '../players/players.module.js';
import { Profiles } from '../players/profiles.service.js';
import { AccountController } from './account.controller.js';
import { AccountPagesController } from './account-pages.controller.js';
import { AccountServicesModule } from './account-services.module.js';
import { Accounts } from './accounts.service.js';
import { SignInProviders } from './sign-in-providers.js';

/** Where the mail links land: the API's own small pages (account-pages.controller.ts). */
export const PAGES = {
  resetPassword: '/api/account/reset-password',
  emailVerified: '/api/account/email-verified',
} as const;

/** The domain of a guest's placeholder address (RFC 2606's reserved `.invalid`): never mailed. */
export const GUEST_EMAIL_DOMAIN = 'guest.gravoth.invalid';

/**
 * Accounts (docs/online-plan.md, step 2): guests, our own email and password accounts, and the OAuth / OpenID Connect
 * providers in `SignInProviders` (Google and Discord once their clients are configured). No store or platform service:
 * the same accounts on Android, PC and iOS. better-auth serves the sign-in endpoints under `/api/auth`, over the app's
 * one Postgres pool; `/api/account` is the game's view of the caller.
 *
 * Named for the feature, so `AuthModule` still means `@dunx/auth`'s.
 */
@Module({
  imports: [
    DatabaseModule,
    MailModule,
    PlayersModule,
    AccountServicesModule,
    AuthModule.forRootAsync(
      {
        imports: [DatabaseModule, MailModule, PlayersModule, AccountServicesModule],
        useFactory: (
          config: AppConfigService,
          connection: DbConnection,
          mail: Mailer,
          providers: SignInProviders,
          profiles: Profiles,
          upgrade: GuestUpgrade,
          logger: Logger,
        ) => {
          const publicUrl = config.get('publicUrl');
          const website = URL.parse(config.get('corsOrigin'))?.origin;
          return {
            appName: 'Gravoth',
            // better-auth's own lines through the app's logger, so they are JSON in
            // production like every other line.
            logger: {
              log: (level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: unknown[]) =>
                logger[level](`[better-auth] ${message}`, ...(args.length === 0 ? [] : [{ details: args }])),
            },
            secret: config.get('auth.secret'),
            // better-auth rejects a browser request whose Origin is not this (or a trusted origin below), and builds
            // every OAuth redirect URI from it: `<PUBLIC_URL>/api/auth/callback/<provider>`.
            baseURL: publicUrl,
            basePath: '/api/auth',
            trustedOrigins: website === undefined || website === 'null' ? [] : [website],
            // The tables are drizzle's (database/auth.schema.ts), the pool the app's own.
            database: drizzleDatabase(connection),
            // Postgres makes the ids (uuid columns with gen_random_uuid()), so every foreign key to a user is one type.
            advanced: {
              database: { generateId: 'uuid' as const },
              // Behind the Cloudflare Tunnel the caller's address is Cloudflare's header,
              // which better-auth's own rate limit counts by.
              ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
            },
            // A session lives `AUTH_SESSION_DAYS` unused, and a day of use extends it.
            session: { expiresIn: config.get('auth.sessionDays') * 86_400, updateAge: 86_400 },
            emailAndPassword: {
              enabled: true,
              minPasswordLength: 8,
              maxPasswordLength: 128,
              // `Bun.password`'s native bcrypt, not better-auth's JavaScript scrypt.
              password: bunPassword,
              // Playing never waits on a mail; the account shows whether the address is confirmed.
              requireEmailVerification: false,
              revokeSessionsOnPasswordReset: true,
              sendResetPassword: async ({ user, token }: { user: { email: string; name: string }; token: string }) =>
                mail.passwordReset(user.email, user.name, `${publicUrl}${PAGES.resetPassword}?token=${encodeURIComponent(token)}`),
            },
            emailVerification: {
              sendOnSignUp: true,
              sendVerificationEmail: async ({ user, token }: { user: { email: string; name: string }; token: string }) =>
                mail.verification(
                  user.email,
                  user.name,
                  `${publicUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(PAGES.emailVerified)}`,
                ),
            },
            // Google (an ID token from the device, or a browser redirect with PKCE) and Discord (the redirect). Each
            // only while its client is configured.
            socialProviders: providers.social(),
            account: {
              accountLinking: {
                enabled: true,
                // A provider's address joins an existing account only when both sides have confirmed it: the
                // provider says the address is verified, and the account has confirmed the same one (better-auth's
                // defaults, stated). Otherwise the sign-in is refused rather than joined to someone else's account.
                requireLocalEmailVerified: true,
              },
            },
            databaseHooks: {
              user: {
                create: {
                  // After the user's transaction commits: the profile, under a free display name.
                  after: async (user: { id: string; name: string; isAnonymous?: boolean | null }) => {
                    await profiles.ensure(user.id, user.name, user.isAnonymous === true);
                  },
                },
              },
            },
            plugins: [
              // `role` on the user, for `@Roles('admin')` and the moderation of step 6.
              admin(),
              // The game sends `Authorization: Bearer <token>`; the token comes back in
              // `set-auth-token` at every sign-in.
              bearer(),
              /**
               * Guest accounts: `POST /api/auth/sign-in/anonymous` makes one with no credentials. A guest who then
               * signs up or signs in (email, Google, Discord) with the guest's token is moved onto that account
               * (players/guest-upgrade.ts), and the guest account is deleted.
               */
              anonymous({
                emailDomainName: GUEST_EMAIL_DOMAIN,
                generateName: () => 'Guest',
                onLinkAccount: async ({ anonymousUser, newUser }) => {
                  await upgrade.move(anonymousUser.user.id, newUser.user.id);
                },
              }),
              // What makes `generateOpenAPISchema` exist for `betterAuthDocument`.
              openAPI({ disableDefaultReference: true }),
            ],
          };
        },
        inject: [AppConfigService, DbConnection, Mailer, SignInProviders, Profiles, GuestUpgrade, Logger] as const,
      },
      '/auth',
    ),
  ],
  controllers: [AccountController, AccountPagesController],
  providers: [Accounts],
  // `Auth` is exported because `OpenApiModule` wraps the root and can only inject
  // what the root exports (main.ts); the rest for the features that need the caller.
  exports: [Auth, AuthContext, SessionGuard, Accounts],
})
export class AccountsModule {}
