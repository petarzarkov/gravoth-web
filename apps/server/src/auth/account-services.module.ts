import { Module } from '@dunx/core';
import { SignInProviders } from './sign-in-providers.js';

/**
 * The third-party sign-in providers better-auth's options are built from. Its own module, because
 * `AuthModule.forRootAsync`'s factory can only inject what the modules it names export.
 */
@Module({
  providers: [SignInProviders],
  exports: [SignInProviders],
})
export class AccountServicesModule {}
