import type { AvatarView } from '@gravoth/contracts';
import {
  AVATAR_BORDER_NAMES,
  avatarBorderOf,
  type AvatarBorder,
} from '@gravoth/contracts/constants';
import { Avatar } from '@mantine/core';
import { useState } from 'react';

/** A portrait's image on this site (`public/img/portraits`, the game's NPC portraits at 192 px). */
export const portraitSrc = (id: string): string => `/img/portraits/${id}.webp`;

/** A border's frame on this site (`public/img/borders`, the game's frames at 256 px wide, transparent). */
export const borderSrc = (key: AvatarBorder): string =>
  `/img/borders/${key}.webp`;

/**
 * The frame's geometry, the game's own (`BorderRing.cs`): its round hole is 56% of the frame's width, with its centre
 * half the width above the frame's bottom edge (a frame with a tall crest is taller and reaches upward), and the hole
 * is 96% of the picture's diameter, so the frame's inner edge covers the picture's rim.
 */
export const BORDER_HOLE_SHARE = 0.56;
export const BORDER_HOLE_ON_PICTURE = 0.96;

/** The frame's width round a picture of `size` px. */
export const borderWidth = (size: number): number =>
  Math.round((size * BORDER_HOLE_ON_PICTURE) / BORDER_HOLE_SHARE);

/**
 * A player's picture, round with a thin gold edge: their Google or Discord photo, loaded from the provider without a
 * referrer and falling back to their portrait if it will not load, or their portrait. `null` (a hidden player) is an
 * empty silhouette. Decorative by default (the name is beside it); give `label` where it stands alone.
 *
 * `border` is the hero's avatar border (a build's `extras.border`): given at all (a key, or null for none), the picture
 * sits in the frame's square so a list lines up whether a row has one; a key the site knows shows its frame round the
 * picture, anything else none.
 */
export const PlayerAvatar = ({
  avatar,
  size = 32,
  label,
  border,
}: {
  avatar: AvatarView | null;
  size?: number;
  label?: string;
  border?: unknown;
}) => {
  const [failed, setFailed] = useState<string | null>(null);
  const photo =
    avatar?.kind === 'provider' && avatar.url !== null && avatar.url !== failed
      ? avatar.url
      : null;
  const src = avatar === null ? null : (photo ?? portraitSrc(avatar.portrait));
  const picture = (
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
  if (border === undefined) return picture;
  const key = avatarBorderOf(border);
  const width = borderWidth(size);
  const named = key === null ? null : AVATAR_BORDER_NAMES[key];
  return (
    <span
      className="avatar-frame"
      style={{ width, height: width }}
      {...(key === null
        ? {}
        : {
            'data-border': key,
            title: `${named?.name}: ${named?.earned}`,
          })}
    >
      {picture}
      {key === null ? null : (
        <img
          className="avatar-frame-img"
          src={borderSrc(key)}
          alt=""
          aria-hidden="true"
          width={width}
          loading="lazy"
          decoding="async"
        />
      )}
    </span>
  );
};
