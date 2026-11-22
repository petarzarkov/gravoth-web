# How Gravoth Online fits together

The product plan (what each step gives players, the decisions behind it) is in
the game's repository: `docs/online-plan.md` and `docs/poc-decisions.md`
(decisions 171, 216, 218, 219 and 225). This page is the code's side.

```
 the game (Unity, Android)          the website (apps/web, Cloudflare Pages)
        │  bearer token                   │  session cookie, credentialed CORS
        └──────────────┬──────────────────┘
                       ▼
              apps/server (dunx on Bun)  ──►  validator (the game's Core, .NET)
               │        │        │
            Postgres   Redis   Resend, R2
```

## The three packages

- **`packages/contracts`** is every shape the API and a client agree on: the
  request schemas (zod, which the server's routes validate with and the OpenAPI
  document is built from), the response shapes (TypeScript), and the plain
  facts (the boards, classes, item slots, error codes, page limits) in
  `constants.ts`, which imports nothing so a browser bundle stays small. The
  game's C# client mirrors the same shapes by hand; the OpenAPI document at
  `/api/openapi.json` is the reference for it.
- **`apps/server`** is the API. Each feature is a dunx module (`auth`,
  `players`, `social`, `heroes`, `boards`, `saves`, `mail`, `backup`) over one Postgres
  pool (drizzle over `Bun.SQL`). better-auth serves sign-in under `/api/auth`:
  the game sends `Authorization: Bearer`, the website a first-party cookie.
  `web/` serves the website's build.
- **`apps/web`** is the website: React 19 with Mantine 9 (`theme.ts`, the
  game's palette, always dark) on Bun's bundler, and a small history router
  (`router.tsx`). Pages: the boards
  (`/`, `/boards/:key`), a build card (`/builds/:id`), sign-in, the account
  (with the cloud save) and friends. Every request goes through `api.ts`, typed by the contracts.

## The database

Everything a player has hangs off their user row, so deleting the user deletes
it all in one statement, and the database refuses data that does not fit
together. The tables (`apps/server/src/database/`):

| Table                       | What it holds                                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`, `accounts`         | better-auth's user, and one row per linked sign-in (`credential`, `google`, `discord`)                                                                     |
| `sessions`, `verifications` | sessions (the bearer token) and mail-link codes                                                                                                            |
| `profiles`                  | the display name (unique in any case, format-checked, word-filtered), the picture (a portrait or the sign-in's photo), the flags                           |
| `friendships`, `blocks`     | one row per pair whichever asked (`pending` or `accepted`), never oneself; blocks one way                                                                  |
| `heroes`                    | a hero the server knows: name (once per player), class, hardcore, online                                                                                   |
| `hero_builds`               | an immutable snapshot of a hero's whole build at a revision (a trigger refuses any update); the sorted numbers lifted to columns                           |
| `leaderboards`              | a board: the game's key, title, order, format, score range, hardcore, season; written from code at boot                                                    |
| `leaderboard_entries`       | a hero's best on a board with the build that set it; the database checks that build is the hero's and the hero the player's                                |
| `cloud_saves`               | the game's cloud save, one per account (never a guest's): the decoded bytes (`bytea`), their size and SHA-256, the description, play time and game version |

A player's picture is one of the game's 42 portraits (`AVATAR_PORTRAITS`, a
random one at sign-up) or their Google or Discord photo. The photo is linked,
never copied: `users.image` holds the provider's own address, which every
sign-in with that provider brings up to date (`auth/provider-photos.ts`, on the
providers' user-info step, so the redirect and Android's ID token both do it),
and the site's image policy allows those hosts (`AVATAR_IMAGE_SOURCES`). Only
an address on those hosts is ever shown (`players/avatars.ts`); a `provider`
picture whose photo is gone shows its portrait. On a board row and a build
card the picture wears the hero's avatar border, which the build carries
(`extras.border`, one of `AVATAR_BORDERS`; the game's frames are in
`apps/web/public/img/borders`).

A Google or Discord sign-in's access and refresh tokens are stored encrypted
with `AUTH_SECRET`, and its ID token not at all (`auth/oauth-tokens.ts`); the
server never calls a provider with them. Guests with no heroes and no use in
30 days are deleted every day at 04:15 (`players/guest-cleanup.ts`), and the
request logs never hold a sign-in's one-time `code` or `state`
(`http/log-redaction.ts`).

## The cloud save

The game keeps its heroes on the phone; since Google Play's cloud saves went
(decision 215), its cloud-save seam (`CloudSync.IProvider`, decision 87's rule:
compare fingerprints, upload at most once a minute and on pause, ask the player
when the two differ) has this server as its provider (decision 225).
`/api/saves/me` holds one copy per account: `GET` (with `?data=false` the
website reads everything but the bytes), `PUT` replacing it whole (base64 that
must encode back to itself, at most 3 MB decoded, 413 `SAVE_TOO_LARGE` over it,
240 writes an hour per caller) and `DELETE`. A guest gets 403 `GUEST_ACCOUNT`:
it has no way back in to read a copy, so its save stays on the phone, and a
guest that signs up has nothing to move. The bytes are stored decoded, as
`bytea` (`database/columns.ts`: `Bun.SQL` sends a `Uint8Array` as binary and
reads a `Buffer` back, so the column passes the value through), and a check
holds `size` to `octet_length(data)`. The copy goes with its user, and the
nightly dump carries it like every table.

## The website, and its copy on the API

The website lives on Cloudflare Pages at gravoth.petarzarkov.com (decision
220; `docs/deploy.md`, "The website on Pages") and calls the API at
gravoth-api.petarzarkov.com. The two are one site, so the API's session cookie
goes with the site's credentialed calls, and the API trusts the site through
`CORS_ORIGIN`.

`apps/web` builds into `apps/web/dist`: `index.html`, content-hashed assets
under `/assets/`, and `public/` (the screenshots, `/privacy/`). The server also
serves that directory (`WEB_ROOT`), same origin:

- a folder with its own page (`/privacy/`) is served as that page;
- `SpaShell` answers `index.html` for a browser asking for any path the site
  owns (no route matched, `GET`, `Accept: text/html`, not under `/api`, no dot
  in the last segment), with `no-cache` and the strict content security policy;
- dunx's `StaticFiles` serves the assets, a hashed name with a one-year
  immutable cache;
- everything under `/api` is the API's, so a missing route there is still a
  JSON 404.

`CORS_ORIGIN` names the one other origin the API trusts: the Pages site in
production, the dev server (`bun run dev:web`, :3001) or the end-to-end run's
Pages stand-in (`e2e/pages.ts`, :3001).

## Scores and the rules checker

A score arrives with the whole build (`SubmitScore`). The server asks the
rules checker through `BuildCheck`, an interface: verified, pending (shown) or
flagged (hidden). A hero keeps one entry a board: a flagged attempt never
replaces it (it is recorded only when the hero had none, and logged for review
either way), and any other attempt replaces a flagged entry, so one
contradicted claim can neither wipe a standing record nor bury the honest ones
after it. The answer's `check` says how that one submission was judged. Only
the chart tier is checked against the save so far;
the Pit floor, Marks and the times need the checker to report board records
(the open-issues list in the game's repository).
