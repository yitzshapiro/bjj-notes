# BJJ Notes

BJJ Notes is a private, single-user video study notebook for a Google Drive library. It mirrors one configured Drive folder without renaming or flattening it, remembers playback progress in Neon Postgres, and keeps timestamped notes, running notes, divisions, and focused/starred sections beside each video.

The app is intended to run locally. It does not need to be deployed or made available to other users.

## What it does

- Signs in with Google OAuth and rejects every account except one configured email address.
- Requests Google Drive read-only access.
- Mirrors the exact folder and video names beneath one configured parent folder.
- Saves playback position, completion state, timestamped notes, running notes, division presets, and starred/focused video sections in Neon.
- Exports timestamped notes, running notes, or both as Markdown or JSON.
- Supports desktop and mobile layouts.

BJJ Notes does not upload, rename, move, edit, or delete anything in Google Drive. The Drive folder remains the source of truth for the video hierarchy; Neon stores app state and a metadata index.

## Prerequisites

- Node.js 20 or newer
- pnpm 10 (the repository pins the expected version in `package.json`)
- A Neon account and database
- A Google Cloud project owned by the Google account that will use BJJ Notes
- A Google Drive parent folder containing the video library

## Local setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create a Neon project and copy its pooled/serverless Postgres connection string. See [Neon database setup](#neon-database-setup).

3. Enable the Google Drive API and create a Google OAuth Web application client. Register this local callback exactly:

   ```text
   http://localhost:3000/api/auth/callback/google
   ```

   The complete walkthrough is in [docs/google-oauth-setup.md](docs/google-oauth-setup.md).

4. Copy `.env.example` to `.env.local`, then replace every placeholder:

   ```bash
   cp .env.example .env.local
   ```

5. Apply the checked-in database migrations:

   ```bash
   pnpm db:migrate
   ```

6. Start the app locally and open `http://localhost:3000`:

   ```bash
   pnpm dev
   ```

7. Sign in with the exact account in `ALLOWED_GOOGLE_EMAIL`, then sync the library. An account with any other email is denied even if it can complete Google's OAuth screen.

## Neon database setup

1. In the [Neon console](https://console.neon.tech/), create a project and database. A free development project is sufficient for a personal library.
2. In the project's **Connect** panel, select the database and copy the pooled connection string. It normally ends with `?sslmode=require`.
3. Put that entire string in `DATABASE_URL` in `.env.local`. Do not commit it.
4. Run `pnpm db:migrate` once and whenever new checked-in migrations are added.

`pnpm db:generate` is for developers changing `src/db/schema.ts`; it generates a migration for review. It is not needed for an ordinary first-time setup.

Neon stores:

- the Drive metadata needed to rebuild the library tree;
- current playback position and completion status;
- timestamped and running notes;
- reusable division presets; and
- video sections, including starred and current-focus state.

Video bytes remain in Google Drive and are not copied into Postgres.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon pooled/serverless Postgres connection string. |
| `AUTH_SECRET` | Random secret used to protect the local Auth.js session. Generate one with `openssl rand -base64 32`. |
| `AUTH_GOOGLE_ID` | OAuth Web application client ID from Google Cloud. |
| `AUTH_GOOGLE_SECRET` | OAuth Web application client secret from Google Cloud. |
| `ALLOWED_GOOGLE_EMAIL` | The one Google account allowed to sign in. Comparison is case-insensitive. |
| `DRIVE_ROOT_FOLDER_ID` | ID of the parent Drive folder mirrored by BJJ Notes. |

Restart the local app after changing environment variables.

## Finding the parent folder ID

Open the intended parent folder in Google Drive. Its URL looks like:

```text
https://drive.google.com/drive/folders/1ExampleFolderIdHere
```

Copy only the value after `/folders/` into `DRIVE_ROOT_FOLDER_ID`. The signed-in account must be able to read that folder and its descendants.

Only descendants of this root are shown. Folder and video names are kept verbatim, and the tree uses the same nesting as Drive. Non-video files are ignored.

## Exports

Each video's notes can be exported in either format:

- **Markdown (`.md`)** — readable headings, Drive path, progress, sections, timestamped notes, and/or running notes.
- **JSON (`.json`)** — structured data suitable for backup or another tool.

For either format, choose a combined export or export only timestamped notes or only running notes. Exporting downloads a copy; it does not remove or alter the state in Neon.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run BJJ Notes locally. |
| `pnpm test` | Run unit tests once. |
| `pnpm typecheck` | Check TypeScript without producing build files. |
| `pnpm lint` | Run the code-quality checks. |
| `pnpm build` | Create a production build as a verification step; deployment is optional and not required. |
| `pnpm db:generate` | Generate a migration after an intentional schema change. |
| `pnpm db:migrate` | Apply checked-in migrations to `DATABASE_URL`. |

## Privacy and security

- Keep `.env.local` local and never commit OAuth credentials, `AUTH_SECRET`, or the Neon connection string.
- Use a unique `AUTH_SECRET`, even though the app only runs on your computer.
- Keep `ALLOWED_GOOGLE_EMAIL` set. An empty allowlist denies all sign-ins rather than opening the app.
- Google access tokens are kept in the encrypted/signed Auth.js session flow and are used server-side. Do not expose them in browser-visible logs or exports.
- The OAuth scope is `drive.readonly`; the app cannot change Drive contents through this authorization.
- Notes may contain private training information. Neon is remote storage, so protect the Neon account with MFA and rotate the database password if the connection string is exposed.
- The local-only design reduces exposure, but `localhost` is not a substitute for the email allowlist or proper secrets.

See [docs/architecture.md](docs/architecture.md) for the data flow and trust boundaries.

