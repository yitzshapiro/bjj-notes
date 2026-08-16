# Architecture

## Overview

Rollbook is a local-first-in-usage, server-backed Next.js application. The browser provides the responsive library, video, and note-taking experience; the Next.js server keeps Google and Neon credentials out of browser code; Google Drive remains the source of truth for media and hierarchy; and Neon Postgres stores durable study state.

```text
Browser on localhost
        │ session requests, library actions, notes, progress
        ▼
Next.js server + Auth.js
        ├── Google OAuth identity and read-only Drive API
        └── Drizzle ORM → Neon Postgres
```

No deployment is required. In the intended setup, both the browser and Next.js process run on the user's computer while Google and Neon remain external services.

## Responsibilities

### Browser UI

- Shows the Drive folder tree without changing its names or nesting.
- Plays the selected video and restores saved progress.
- Captures timestamped notes at a playback position and free-form running notes.
- Applies reusable division labels to video sections and exposes starred/current-focus state.
- Requests Markdown or JSON exports.

The browser should never receive the Google client secret, Neon connection string, refresh token, or raw database access.

### Next.js server

- Completes the Google OAuth flow through Auth.js.
- Enforces the single-email allowlist at sign-in and authentication on private routes.
- Refreshes Google access tokens when needed.
- Calls Google Drive with the read-only scope.
- Validates mutations and reads/writes the app's state through Drizzle.
- Streams or proxies video reads when authenticated Drive access is required.

### Google Drive

Google Drive owns the video files and canonical folder structure. `DRIVE_ROOT_FOLDER_ID` is the only library entry point. Sync walks descendants of that folder, retains exact names and parent relationships, indexes folders and `video/*` files, and ignores unrelated files.

The OAuth permission is `drive.readonly`. Rollbook does not have authorization to reorganize the library or modify any Drive item.

### Neon Postgres

Neon holds durable app state and a synchronized Drive metadata index. Drizzle migrations define these tables:

| Table | Responsibility |
| --- | --- |
| `drive_items` | Folder/video metadata, exact path, parent, ordering, media metadata, and sync/deletion timestamps. |
| `video_progress` | Playback position, known duration, completion, and last-watched time. |
| `timestamped_notes` | Notes tied to a playback time within a video. |
| `running_notes` | One free-form running note document per video. |
| `division_presets` | Reusable section labels, optional colors, and ordering. |
| `video_sections` | Per-video labeled time ranges with starred and focused state. |

App-owned video records reference `drive_items`. Deleting a video record cascades to its progress, notes, and sections; a deleted division preset leaves its video section intact and clears only the preset reference.

## Library synchronization and hierarchy

The Drive root and every discovered descendant are normalized into metadata records. The local tree is then constructed from parent IDs rather than by parsing or rewriting names:

1. Load the configured root.
2. Discover descendant folders and video files.
3. Preserve every item's exact Drive name and parent relationship.
4. Build an in-memory tree from those relationships.
5. Sort deterministically for a stable UI while keeping the underlying names unchanged.

Folders appear before videos, and names use natural numeric ordering so `Lesson 2` precedes `Lesson 10`. A deterministic ID tie-breaker handles duplicate names. Items not reachable from the configured root do not enter the visible library.

Sync is metadata-only. The database does not store video bytes, and a synchronization never writes to Drive.

## Authentication and authorization

The authorization layers are intentionally separate:

1. Google authenticates the account and grants Drive read-only consent.
2. The Auth.js `signIn` callback compares the verified Google email with `ALLOWED_GOOGLE_EMAIL`.
3. Private pages and server operations require an authenticated session.
4. Drive operations remain limited by both Google's read-only scope and the account's existing Drive permissions.

An empty allowlist fails closed. The OAuth flow requests offline access so the server can refresh short-lived access tokens; refresh failure should return the user to sign-in rather than exposing credentials or silently bypassing Drive checks.

## State and write behavior

The application writes only app-owned state to Neon. Playback updates should be throttled or saved at meaningful events such as pause, seek completion, or page exit rather than on every video frame. Text changes should use reactive, debounced saves with visible saving/saved/error feedback so desktop and mobile use do not depend on form submission.

Drive sync and app-state mutations are separate operations. A Drive rename or move becomes visible after synchronization; it must not discard notes because app state keys use the stable Drive file ID.

## Exports

Exports are pure projections of one video's state:

- `combined` includes progress, sections, timestamped notes, and running notes;
- `timestamped` includes only time-linked notes and video identity/path; and
- `running` includes only the running note and video identity/path.

Markdown favors human reading. JSON retains structured IDs, seconds, flags, and paths for backups or later tooling. Timestamped notes are sorted by time with an ID tie-breaker, making repeated exports stable. Generating an export does not mutate Neon or Drive.

## Trust boundaries and privacy

| Boundary | Sensitive data | Control |
| --- | --- | --- |
| Browser ↔ local Next.js server | Session and personal notes | Authenticated routes, validated payloads, same-origin requests. |
| Next.js server ↔ Google | Access/refresh tokens and video content | Server-only tokens, exact OAuth callback, read-only scope. |
| Next.js server ↔ Neon | Notes, progress, Drive metadata | Server-only TLS connection string and migrations. |
| Local environment | OAuth secret, Auth.js secret, database credentials | Uncommitted `.env.local`, OS account protection, secret rotation. |

The app is single-user by design, but local-only operation does not remove the need for authorization. Every server operation must continue to validate the session; the email allowlist must remain configured; and exports should be treated as personal data once downloaded.

