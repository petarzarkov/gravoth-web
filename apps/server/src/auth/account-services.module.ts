import { Module } from '@dunx/core';
import { DatabaseModule } from '../database/database.module.js';
import { ProviderPhotos } from './provider-photos.js';
import { SignInProviders } from './sign-in-providers.js';

/**
 * The third-party sign-in providers better-auth's options are built from, and what keeps their photos fresh. Its own
 * module, because `AuthModule.forRootAsync`'s factory can only inject what the modules it names export.
 */
@Module({
  imports: [DatabaseModule],
  providers: [SignInProviders, ProviderPhotos],
  exports: [SignInProviders, ProviderPhotos],
})
export class AccountServicesModule {}
