import {
  AVATAR_IMAGE_SOURCES,
  AVATAR_PORTRAITS,
  type AvatarPortrait,
  type AvatarView,
} from '@gravoth/contracts';

/** A portrait for a new profile: any of the game's, at random (a picture, not game content: no seeded random needed). */
export const randomPortrait = (): AvatarPortrait =>
  AVATAR_PORTRAITS[Math.floor(Math.random() * AVATAR_PORTRAITS.length)] ??
  'warden';

/** `https://*.googleusercontent.com` matches any subdomain, `https://cdn.discordapp.com` that host only. */
const SOURCES = AVATAR_IMAGE_SOURCES.map((source) => {
  const host = source.replace(/^https:\/\//, '');
  return host.startsWith('*.')
    ? (hostname: string) => hostname.endsWith(host.slice(1))
    : (hostname: string) => hostname === host;
});

/**
 * The sign-in's photo when it is one other players may see, else null: an `https` address on a host the site's image
 * policy allows (`AVATAR_IMAGE_SOURCES`), and a picture of the player's own, not Discord's generated default avatar
 * (`/embed/avatars/<n>.png`, given to everyone without one). `users.image` is better-auth's column, which its own
 * `update-user` route lets a player set to anything; this is what keeps another address off the boards.
 */
export const providerPhoto = (
  image: string | null | undefined,
): string | null => {
  if (image === null || image === undefined || image.length > 2048) return null;
  const url = URL.parse(image);
  if (url === null || url.protocol !== 'https:' || url.port !== '') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (!SOURCES.some((matches) => matches(url.hostname))) return null;
  if (
    url.hostname === 'cdn.discordapp.com' &&
    url.pathname.startsWith('/embed/avatars/')
  )
    return null;
  return url.href;
};

/** The picture as a profile stores it. */
export interface StoredAvatar {
  readonly avatarKind: 'provider' | 'portrait';
  readonly avatarPortrait: string;
}

const isPortrait = (id: string): id is AvatarPortrait =>
  (AVATAR_PORTRAITS as readonly string[]).includes(id);

/**
 * What others see: the photo for `provider` while the user has one, else the portrait (the stored kind is left alone,
 * so a photo that comes back at the next sign-in shows again without the player choosing it twice).
 */
export const avatarView = (
  stored: StoredAvatar,
  image: string | null | undefined,
): AvatarView => {
  const portrait = isPortrait(stored.avatarPortrait)
    ? stored.avatarPortrait
    : 'warden';
  const photo = stored.avatarKind === 'provider' ? providerPhoto(image) : null;
  return photo === null
    ? { kind: 'portrait', portrait, url: null }
    : { kind: 'provider', portrait, url: photo };
};
