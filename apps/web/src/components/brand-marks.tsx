/**
 * The sign-in buttons' marks, in one place so the game's art can be rendered from the same source: Google's
 * four-colour G and Discord's mark, both exactly as their brand guidelines publish them (never recoloured, stretched
 * or redrawn), and Gravoth's own icon. Each is decorative: the button's text names the way in.
 */

/** Discord's blurple, the tile its white mark sits on. */
export const DISCORD_BLURPLE = '#5865F2';

/** Gravoth's icon (the game's launcher icon). */
export const GRAVOTH_ICON = '/img/icon-192.png';

export const GoogleMark = ({ size = 20 }: { size?: number }) => (
  <svg
    viewBox="0 0 48 48"
    width={size}
    height={size}
    aria-hidden="true"
    focusable="false"
  >
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
);

/** Discord's mark, white, as it sits on its blurple tile (`DiscordTile`). */
export const DiscordMark = ({ size = 20 }: { size?: number }) => (
  <svg
    viewBox="0 0 127.14 96.36"
    width={size}
    height={(size * 96.36) / 127.14}
    aria-hidden="true"
    focusable="false"
  >
    <path
      fill="#fff"
      d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"
    />
  </svg>
);

/** Discord's white mark on a rounded blurple square, `size` across. */
export const DiscordTile = ({ size = 28 }: { size?: number }) => (
  <span
    className="brand-tile"
    style={{ width: size, height: size, background: DISCORD_BLURPLE }}
    aria-hidden="true"
  >
    <DiscordMark size={Math.round(size * 0.62)} />
  </span>
);

/** Gravoth's icon in the same rounded square. */
export const GravothTile = ({ size = 28 }: { size?: number }) => (
  <span
    className="brand-tile brand-tile-gravoth"
    style={{ width: size, height: size }}
    aria-hidden="true"
  >
    <img src={GRAVOTH_ICON} alt="" width={size} height={size} />
  </span>
);
