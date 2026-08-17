# Google Drive and OAuth setup

BJJ Notes uses Google OAuth for identity and for server-side, read-only access to one Drive library. These steps create a local Web application client; no deployment is required.

## 1. Create or select a Google Cloud project

1. Open the [Google Cloud console](https://console.cloud.google.com/).
2. Create a new project, or select a project used only for this app.
3. Confirm that the intended Google account owns or can administer the project.

## 2. Enable the Google Drive API

1. Open **APIs & Services → Library**.
2. Search for **Google Drive API**.
3. Select it and choose **Enable**.

The app requests only:

```text
https://www.googleapis.com/auth/drive.readonly
```

That scope can list and read files the signed-in account can already access, but it cannot upload, rename, move, modify, or delete Drive items.

## 3. Configure the OAuth consent screen

1. Open **Google Auth Platform** (or **APIs & Services → OAuth consent screen**, depending on the current Cloud console layout).
2. Configure the app name and support/contact email.
3. Select the audience that matches the account:
   - For an ordinary personal Gmail account, choose **External**.
   - For a managed Google Workspace account, **Internal** is appropriate only when the user belongs to that organization.
4. Add the intended Google account as a test user if the app is in testing mode.
5. Add the Drive read-only scope shown above if Google asks you to select data-access scopes.

For this private local app, it is fine to leave the OAuth app in testing mode. Google may require the account to authorize again after a testing-mode refresh token expires. Publishing or verification is not required merely to use the app yourself.

## 4. Create a Web application OAuth client

1. Open **Google Auth Platform → Clients** (or **APIs & Services → Credentials**).
2. Choose **Create client → Web application**.
3. Give the client a recognizable name such as `BJJ Notes local`.
4. Add this authorized JavaScript origin:

   ```text
   http://localhost:3000
   ```

5. Add this authorized redirect URI exactly, including the scheme, port, path, and lowercase provider name:

   ```text
   http://localhost:3000/api/auth/callback/google
   ```

6. Create the client and copy its client ID and client secret.

Put them in `.env.local`:

```dotenv
AUTH_GOOGLE_ID=your-client-id.apps.googleusercontent.com
AUTH_GOOGLE_SECRET=your-client-secret
```

Do not commit or share the client secret.

## 5. Restrict sign-in to one account

Set the exact account email in `.env.local`:

```dotenv
ALLOWED_GOOGLE_EMAIL=you@example.com
```

BJJ Notes normalizes letter case and rejects a sign-in unless Google's email matches this value. OAuth consent alone is not authorization to use the app. If this variable is missing or blank, all sign-ins are denied.

## 6. Select the library root

Open the parent folder in Drive and copy its ID from the URL:

```text
https://drive.google.com/drive/folders/1ExampleFolderIdHere
                                      └─ copy this value ─┘
```

Set it in `.env.local`:

```dotenv
DRIVE_ROOT_FOLDER_ID=1ExampleFolderIdHere
```

The authorized account must have at least viewer access to the root folder and every video that should appear. BJJ Notes follows the hierarchy below this root, retains names exactly, and ignores unrelated Drive content.

## 7. Finish the local configuration

Generate an Auth.js secret and add it to `.env.local`:

```bash
openssl rand -base64 32
```

The completed file should contain all of these keys:

```dotenv
DATABASE_URL=postgresql://...
AUTH_SECRET=...
AUTH_GOOGLE_ID=...
AUTH_GOOGLE_SECRET=...
ALLOWED_GOOGLE_EMAIL=you@example.com
DRIVE_ROOT_FOLDER_ID=...
```

Restart the local app after editing the file.

## Troubleshooting

### `redirect_uri_mismatch`

Compare the callback shown in Google's error with the registered URI. For the default local setup it must be exactly:

```text
http://localhost:3000/api/auth/callback/google
```

An `https` scheme, missing port, trailing slash, different provider casing, or a different hostname is a different URI to Google.

### Access blocked or the app is not verified

Confirm that the OAuth app is in testing mode and the intended account is listed as a test user. Also confirm that the Drive read-only scope is configured on the consent screen.

### The correct Google account is still denied

Confirm that `ALLOWED_GOOGLE_EMAIL` is the exact primary email returned by Google, then restart the app. Aliases may not be returned as the authenticated account's primary email.

### The folder or videos are missing

Confirm that:

- `DRIVE_ROOT_FOLDER_ID` contains only the folder ID, not the whole URL;
- the signed-in account can open the folder and missing videos in Drive;
- the Google Drive API is enabled in the same project as the OAuth client; and
- the files use a `video/*` MIME type rather than being shortcuts or unrelated document types.

### Google asks for consent again

BJJ Notes requests offline access so it can refresh short-lived access tokens. Google testing-mode policies, revoked access, a changed OAuth client, or a removed refresh token can still require a new sign-in and consent.

