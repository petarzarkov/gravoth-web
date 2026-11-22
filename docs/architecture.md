# How Gravoth Online fits together

The product plan (what each step gives players, the decisions behind it) is in
the game's repository: `docs/online-plan.md` and `docs/poc-decisions.md`
(decisions 171, 216, 218, 219, 225, 226, 227 and 228). This page is the code's side.

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
  `players`, `social`, `heroes`, `boards`, `saves`, `realm`, `chat`, `mail`, `backup`) over one Postgres
  pool (drizzle over `Bun.SQL`). better-auth serves sign-in under `/api/auth`:
  the game sends `Authorization: Bearer`, the website a first-party cookie.
  `web/` serves the website's build.
- **`apps/web`** is the website: React 19 with Mantine 9 (`theme.ts`, the
  game's palette, always dark) on Bun's bundler, and a small history router
  (`router.tsx`). Pages: the boards
  (`/`, `/boards/:key`), a build card (`/builds/:id`), a player page
  (`/players/:userId`), sign-in, the account (with the cloud save), friends, and chat moderation
  for the `admin` role (`/admin/chat`). Every request goes through `api.ts`, typed by the contracts.

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
| `heroes`                    | a hero the server knows: name (once per player among the offline ones), class, hardcore, `retired_at`; an online one's realm id, level and `flagged`       |
| `hero_builds`               | an immutable snapshot of a hero's whole build at a revision (a trigger refuses any update); the sorted numbers lifted to columns                           |
| `leaderboards`              | a board: the game's key, title, order, format, score range, hardcore, season; written from code at boot                                                    |
| `leaderboard_entries`       | a hero's best on a board with the build that set it; the database checks that build is the hero's and the hero the player's                                |
| `cloud_saves`               | the game's cloud save, one per account (never a guest's): the decoded bytes (`bytea`), their size and SHA-256, the description, play time and game version |
| `realms`                    | the online realm, one per account (never a guest's): the save's bytes, revision, size, SHA-256, the checked revision, the game version, the lease          |
| `realm_transfers`           | each offline hero moved online, by the rules checker's fingerprint (unique across accounts), with its realm id                                             |
| `chat_messages`             | both channels in one table (one id orders them): `global` with no recipient, `direct` to one player; the filtered body; `hidden_at`/`hidden_by`            |
| `chat_reads`                | how far a player has read each conversation (`last_read_id`, never past its newest message)                                                                |
| `chat_reports`              | one per message and reporter: the reason, the note, a copy of the message (channel, sender, recipient, body, time), the outcome and who closed it          |
| `chat_mutes`                | one per player: until when, why, and the moderator; `profiles.chat_rules_at` is when the player accepted the chat rules                                    |

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

## Players' heroes (decision 226)

The game sends every hero's build when it changes (`POST /api/heroes/:id/builds`,
the builds service the score route uses: one immutable row a revision, `created`
false when it is the hero's latest already; the rules checker's card from the save
sent or the account's cloud save), and the offline heroes still on the phone
(`POST /api/heroes/active`: the others get `retired_at`, their builds and records
kept). `GET /api/players/:userId` is a player page: every hero not retired, each with
its newest build (a board row's `BuildView`) and its shown records ranked as their
boards rank them (`heroes/player-pages.service.ts`, a window over `boards/shown.ts`'s
rule), the newest build's level first. Anyone may read one, a guest's too; a hidden
profile's page is 404 `PLAYER_NOT_FOUND` to anyone but a friend and the player.

## The online realm (decision 227)

Each account (not a guest) has at most one realm: the game's own save holding all its
online heroes, kept by the server (`realms`, bytes as `bytea`), played by one device
at a time (`realm/realms.service.ts`):

- `POST /api/realm/lease` takes or renews the lease (five minutes,
  `REALM_LEASE_SECONDS`); another device's live lease is 409 `REALM_LEASED`
  `{ leaseUntil }` unless `force`. A device keeps its lease past its end until another
  takes it, so a long connection drop loses nothing.
- `PUT /api/realm` replaces the realm whole at `baseRevision + 1` and renews the lease:
  409 `LEASE_LOST` from any device but the holder, 409 `REVISION_MISMATCH`
  `{ revision }` from an old revision, 413 `SAVE_TOO_LARGE` over 3 MB. A transfer
  (`transferred`: the realm ids of offline heroes moved online) is read by the checker
  in the request, and each hero's fingerprint goes into `realm_transfers` in the same
  transaction: one seen before, on any account, is 409 `ALREADY_TRANSFERRED`
  `{ characterIds }`, and a checker that cannot read it 503 `CHECKER_UNAVAILABLE`.
  The game's version comes from its `x-gravoth-client` header. The conflicts' extra
  fields ride on `http/detailed-error.ts`'s `DetailedHttpError`.
- `GET /api/realm` answers the save, its revision, the revision the checker last read
  (`checkedRevision`) and the heroes as it read them; `POST /api/realm/release` ends
  the lease at quit.

After each accepted upload, not blocking the reply, `realm/realm-sync.ts` has the
checker read the realm (`/saves/heroes`, one account at a time, a superseded upload
skipped): each hero's `heroes` row by its realm id (online, name, class, hardcore,
level, `flagged` with the checker's reasons), a new build when its snapshot changed
(`/saves/snapshot`, Core's BuildSnapshotJson, with the checker's numbers and card), and
its board records (the save's witnessed bests: ranked, plausible, a witness the checker
does not refuse) as verified entries when they beat the hero's. Online heroes no longer
in the realm are retired; a realm that does not read flags them all; a checker down
leaves the realm unchecked until the next upload.

The fingerprint is the checker's (`SaveHeroes.Fingerprint` in the game's repository):
SHA-256 of the hero's class, body and hair (fixed at creation) and the first five
entries of its level clock (the play seconds at levels 2-6, never rewritten), or its
name while the clock is shorter. A save has no creation time and a moved hero gets a
new id in the realm, so neither can identify it.

## Chat (decision 228)

One global channel every account reads and writes, and direct messages between
friends, read by polling (the game asks for what is new while CHAT is open; no
socket). Everything is under `/api/chat` (`chat/`), and every route needs an
account that can sign in again (a guest gets 403 `GUEST_ACCOUNT`):

- `GET /api/chat/global` and `GET /api/chat/direct/:userId` answer a `ChatPage`:
  messages oldest first; `after` (the poll: the ones newer than that id, and
  `gap: true` with the newest `take` when more are newer), `before` (scrolling
  back) or neither (the newest); `removed`, the ids moderation hid in that
  channel in the last day; the caller's `muted` and `rulesAccepted`. A
  conversation stays readable to both players once they are no longer friends.
- `GET /api/chat/direct` lists the conversations newest first, each with its last
  shown line and unread count; `GET /api/chat/unread` is the badge; `POST
/api/chat/direct/:userId/read` moves the read mark (held at the conversation's
  newest message, never back).
- Sending (`POST /api/chat/global`, `POST /api/chat/direct/:userId`,
  `chat/chat-sends.ts`) checks in order: the rules accepted (`POST
/api/chat/rules/accept`, once: 403 `CHAT_RULES`), no mute (403 `CHAT_MUTED`
  with `until` and `reason`), a friend for a direct message (403 `NOT_FRIENDS`),
  the filter (422), then under a Postgres advisory lock on the sender: ten
  messages a minute across both channels, counted from the sender's own rows
  (429 `TOO_MANY_REQUESTS` with `Retry-After`; the per-route `@Throttle` counts an
  address, which a carrier's players share, so it is only a looser outer limit),
  and not the text of the sender's last message in that channel within 30
  seconds (409 `CHAT_REPEAT`).
- The filter (`chat/chat-filter.ts`) reads the display names' lists by kind
  (`players/display-names.ts`): hate refused (422 `MESSAGE_NOT_ALLOWED`),
  obscenities masked with one `*` per character, the staff words left to names;
  the same look-alike folding, whole-word matching for the short words (so
  `Assassin` and `grape` pass), dots and repeated letters seen through, and
  control and invisible characters dropped. Links go to `CHAT_LINK_HOST`
  (gravoth.petarzarkov.com) only: a scheme, `www.`, an address or a bare domain
  with a known top-level domain is 422 `LINKS_NOT_ALLOWED`.
- A player the caller blocked has their messages hidden from the caller
  everywhere (global, conversations, unread); blocking ends the friendship, so
  direct messages stop both ways.
- `POST /api/chat/messages/:id/report` takes a message the caller can see and did
  not write (404 `MESSAGE_NOT_FOUND`, 400 `CANNOT_REPORT_SELF`), once per
  reporter (again changes nothing), with a copy of the message; three open
  reports of a global message hide it (`hidden_by` `reports`) until the
  moderator looks.

The moderation routes are `/api/admin/chat` for the `admin` role
(`@Roles('admin')`, 403 for anyone else; `bun run admin:grant`,
`docs/deploy.md`): the reports open or closed, their outcome (`dismiss` shows
again a message the reports hid, `hide`, `mute` for `hours`; each closes every
open report of the message), the mutes (set, replaced, removed), any message
hidden or not (the global channel, a player's, a pair's, `around` an id), and
hiding one. `GET /api/account` answers `admin` so the website can link the page.

Retention (`chat/chat-retention.ts`, daily at 04:45 UTC, after the 03:30 backup
and the 04:15 guest clean-up): messages after 30 days unless an open report
holds them, closed reports 180 days after they closed, mutes once they end.
Everything of a player (their messages and the ones to them, read marks,
reports by them or about their messages, a mute) goes with the account through
the foreign keys.

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

The boards show online heroes only (decision 227, `boards/shown.ts`: not flagged, an
online hero the checker has not flagged), and their records come from their realm. The
score route still answers v0.13.0's records for offline heroes in the same shape: the
build and the entry are stored and checked as below, but the entry is on no board and
its `rank` is null. An online hero's score (and hero build) is 409 `HERO_ONLINE`.

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
