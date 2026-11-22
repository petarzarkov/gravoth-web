/** The game's Play listing (the app id from the game's config/identity.env). */
export const PLAY_URL =
  'https://play.google.com/store/apps/details?id=com.petarzarkov.gravoth';

/** The game's public contact address (the game's config/identity.env), as the privacy policy gives it. */
export const CONTACT_EMAIL = 'gravoth.arpg@gmail.com';

/**
 * Where the API is: empty for the same origin (the API serving this site, or
 * the dev server's pass-through), or the API's origin when the site is hosted
 * apart from it (Cloudflare Pages: https://gravoth-api.petarzarkov.com). Set at
 * build time from GRAVOTH_API_BASE (build.ts).
 */
declare const __GRAVOTH_API_BASE__: string | undefined;
export const API_BASE: string =
  typeof __GRAVOTH_API_BASE__ === 'string' ? __GRAVOTH_API_BASE__ : '';
