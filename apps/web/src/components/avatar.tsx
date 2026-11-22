import type { AvatarView } from '@gravoth/contracts';
import { Avatar } from '@mantine/core';
import { useState } from 'react';

/** A portrait's image on this site (`public/img/portraits`, the game's NPC portraits at 192 px). */
export const portraitSrc = (id: string): string => `/img/portraits/${id}.webp`;

/**
 * A player's picture, round with a thin gold edge: their Google or Discord photo, loaded from the provider without a
 * referrer and falling back to their portrait if it will not load, or their portrait. `null` (a hidden player) is an
 * empty silhouette. Decorative by default (the name is beside it); give `label` where it stands alone.
 */
export const PlayerAvatar = ({
  avatar,
  size = 32,
  label,
}: {
  avatar: AvatarView | null;
  size?: number;
  label?: string;
}) => {
  const [failed, setFailed] = useState<string | null>(null);
  const photo =
    avatar?.kind === 'provider' && avatar.url !== null && avatar.url !== failed
      ? avatar.url
      : null;
  const src = avatar === null ? null : (photo ?? portraitSrc(avatar.portrait));
  return (
    <Avatar
      className="player-avatar"
      src={src}
      alt={label ?? ''}
      size={size}
      {...(label === undefined ? { 'aria-hidden': true } : {})}
      imageProps={
        photo === null
          ? { loading: 'lazy', decoding: 'async' }
          : {
              loading: 'lazy',
              decoding: 'async',
              referrerPolicy: 'no-referrer',
              onError: () => setFailed(photo),
            }
      }
    />
  );
};
