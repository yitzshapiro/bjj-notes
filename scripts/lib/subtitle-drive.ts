import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const FILE_FIELDS = "id,name,mimeType,parents,size,modifiedTime,videoMediaMetadata,driveId,trashed";
// Register this exact URI on the Google OAuth web client used by AUTH_GOOGLE_ID.
export const DRIVE_AUTH_REDIRECT_URI = "http://127.0.0.1:53682/oauth/callback";

export type DriveVideo = {
  id: string;
  name: string;
  path: string[];
  durationSeconds: number | null;
  sizeBytes: number | null;
  modifiedTime: string | null;
};

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  driveId?: string;
  trashed?: boolean;
  videoMediaMetadata?: { durationMillis?: string };
};

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number };

function credentials() {
  const clientId = process.env.AUTH_GOOGLE_ID?.trim();
  const clientSecret = process.env.AUTH_GOOGLE_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET to use Google OAuth authorization or refresh tokens.");
  }
  return { clientId, clientSecret };
}

function nonnegativeNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function toVideo(file: DriveFile, path: string[]): DriveVideo {
  const durationMs = nonnegativeNumber(file.videoMediaMetadata?.durationMillis);
  return {
    id: file.id,
    name: file.name,
    path,
    durationSeconds: durationMs == null || durationMs === 0 ? null : durationMs / 1000,
    sizeBytes: nonnegativeNumber(file.size),
    modifiedTime: file.modifiedTime ?? null,
  };
}

async function pause(milliseconds: number, signal: AbortSignal) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    signal.throwIfAborted();
    await delay(Math.min(60_000, end - Date.now()), undefined, { signal });
  }
}

function retryDelay(response: Response, attempt: number) {
  const value = response.headers.get("retry-after");
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return Math.min(30_000, 1000 * 2 ** attempt);
}

/** Do not propagate response bodies or fetch errors: they can contain credentials. */
async function retryFetch(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal });
    } catch {
      signal.throwIfAborted();
      if (attempt === 4) throw new Error("Google request failed after five network attempts. Check your connection and retry.");
      await pause(1000 * 2 ** attempt, signal);
      continue;
    }
    if ((response.status !== 429 && response.status < 500) || attempt === 4) return response;
    const wait = retryDelay(response, attempt);
    await response.body?.cancel();
    await pause(wait, signal);
  }
  throw new Error("Google request retry limit reached.");
}

async function tokenRequest(body: URLSearchParams, signal: AbortSignal): Promise<TokenResponse> {
  const response = await retryFetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  }, signal);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Google OAuth request failed (HTTP ${response.status}). Check OAuth client settings or run the authorize command again.`);
  }
  let data: TokenResponse;
  try {
    data = await response.json() as TokenResponse;
  } catch {
    throw new Error("Google OAuth returned an invalid response. Please retry authorization.");
  }
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new Error("Google OAuth did not return an access token. Please retry authorization.");
  }
  return data;
}

async function saveAuthorization(authFile: string, refreshToken: string) {
  await mkdir(dirname(authFile), { recursive: true, mode: 0o700 });
  const temporary = `${authFile}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify({ refreshToken })}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, authFile);
  } finally {
    await rm(temporary, { force: true });
  }
}

export class SubtitleDriveClient {
  private accessToken: string | undefined;
  private expiresAt = 0;
  private refreshToken: string | undefined;
  private initialized = false;

  constructor(private readonly options: { authFile: string; signal: AbortSignal }) {}

  private async initialize() {
    if (this.initialized) return;
    this.refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim() || undefined;
    if (!this.refreshToken) {
      let contents: string | undefined;
      try {
        contents = await readFile(this.options.authFile, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new Error("Could not read the Google authorization file. Check its path and permissions.");
        }
      }
      if (contents != null) {
        try {
          const saved = JSON.parse(contents) as { refreshToken?: unknown };
          if (typeof saved.refreshToken !== "string" || !saved.refreshToken.trim()) throw new Error();
          this.refreshToken = saved.refreshToken.trim();
        } catch {
          throw new Error("The Google authorization file is invalid. Run the authorize command again.");
        }
      }
    }
    this.accessToken = process.env.GOOGLE_ACCESS_TOKEN?.trim() || undefined;
    if (!this.refreshToken && !this.accessToken) {
      throw new Error("Google Drive authorization is missing. Run the authorize command, set GOOGLE_REFRESH_TOKEN, or provide a temporary GOOGLE_ACCESS_TOKEN.");
    }
    this.initialized = true;
  }

  private async token(forceRefresh = false): Promise<string> {
    await this.initialize();
    if (this.refreshToken && (forceRefresh || !this.accessToken || Date.now() >= this.expiresAt - 60_000)) {
      const { clientId, clientSecret } = credentials();
      const refreshed = await tokenRequest(new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: this.refreshToken,
      }), this.options.signal);
      this.accessToken = refreshed.access_token;
      this.refreshToken = refreshed.refresh_token || this.refreshToken;
      this.expiresAt = Date.now() + (refreshed.expires_in ?? 3600) * 1000;
    }
    if (!this.accessToken || (forceRefresh && !this.refreshToken)) {
      throw new Error("GOOGLE_ACCESS_TOKEN expired or was rejected. Run the authorize command for automatic refresh, or set a new temporary access token.");
    }
    return this.accessToken;
  }

  private async request(url: string): Promise<Response> {
    let token = await this.token();
    for (let authorizationAttempt = 0; authorizationAttempt < 2; authorizationAttempt += 1) {
      const response = await retryFetch(url, { headers: { Authorization: `Bearer ${token}` } }, this.options.signal);
      if (response.status === 401 && authorizationAttempt === 0) {
        await response.body?.cancel();
        token = await this.token(true);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401) throw new Error("Google Drive authorization was rejected after refresh. Run the authorize command again.");
        throw new Error(`Google Drive request failed (HTTP ${response.status}). Check folder access, drive.readonly permission, or retry later.`);
      }
      return response;
    }
    throw new Error("Google Drive authorization failed.");
  }

  private async json<T>(url: string): Promise<T> {
    const response = await this.request(url);
    try {
      return await response.json() as T;
    } catch {
      this.options.signal.throwIfAborted();
      throw new Error("Google Drive returned an invalid or incomplete JSON response. Please retry.");
    }
  }

  private async file(id: string) {
    const params = new URLSearchParams({ fields: FILE_FIELDS, supportsAllDrives: "true" });
    return this.json<DriveFile>(`${DRIVE_API}/files/${encodeURIComponent(id)}?${params}`);
  }

  async listVideos(rootId: string): Promise<DriveVideo[]> {
    const root = await this.file(rootId);
    if (root.mimeType !== FOLDER_MIME || root.trashed) throw new Error("DRIVE_ROOT_FOLDER_ID must identify an accessible, non-trashed Google Drive folder.");
    const videos: DriveVideo[] = [];
    const visitedFolders = new Set<string>();
    const visitedVideos = new Set<string>();
    const queue = [{ folder: root, path: [root.name] }];
    for (let index = 0; index < queue.length; index += 1) {
      this.options.signal.throwIfAborted();
      const { folder, path } = queue[index];
      if (visitedFolders.has(folder.id)) continue;
      visitedFolders.add(folder.id);
      let pageToken: string | undefined;
      const seenTokens = new Set<string>();
      do {
        const params = new URLSearchParams({
          q: `'${folder.id.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}' in parents and trashed = false`,
          pageSize: "1000",
          fields: `nextPageToken,incompleteSearch,files(${FILE_FIELDS})`,
          spaces: "drive",
          orderBy: "name_natural",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
        });
        if (folder.driveId) {
          params.set("corpora", "drive");
          params.set("driveId", folder.driveId);
        }
        if (pageToken) params.set("pageToken", pageToken);
        const page = await this.json<{ files?: DriveFile[]; nextPageToken?: string; incompleteSearch?: boolean }>(`${DRIVE_API}/files?${params}`);
        if (page.incompleteSearch) throw new Error("Google Drive reported an incomplete folder search. Retry before using this inventory.");
        for (const file of page.files ?? []) {
          if (file.name.startsWith("._")) continue;
          const childPath = [...path, file.name];
          if (file.mimeType === FOLDER_MIME) queue.push({ folder: file, path: childPath });
          else if (file.mimeType.startsWith("video/") && !visitedVideos.has(file.id)) {
            visitedVideos.add(file.id);
            videos.push(toVideo(file, childPath));
          }
        }
        pageToken = page.nextPageToken;
        if (pageToken && seenTokens.has(pageToken)) throw new Error("Google Drive repeated a page token. Retry the inventory.");
        if (pageToken) seenTokens.add(pageToken);
      } while (pageToken);
    }
    return videos.sort((left, right) => left.path.join("/").localeCompare(right.path.join("/"), undefined, { numeric: true }) || left.id.localeCompare(right.id));
  }

  async metadata(video: DriveVideo): Promise<DriveVideo> {
    const file = await this.file(video.id);
    if (!file.mimeType.startsWith("video/") || file.trashed) throw new Error("A selected Drive video is no longer an accessible video. Refresh the inventory.");
    return toVideo(file, [...video.path]);
  }

  async download(video: DriveVideo, destination: string): Promise<void> {
    const params = new URLSearchParams({ alt: "media", supportsAllDrives: "true" });
    const response = await this.request(`${DRIVE_API}/files/${encodeURIComponent(video.id)}?${params}`);
    if (!response.body) throw new Error("Google Drive returned an empty download response.");
    const temporary = `${destination}.${randomBytes(8).toString("hex")}.part`;
    try {
      await mkdir(dirname(destination), { recursive: true });
      await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(temporary, { flags: "wx", mode: 0o600 }), { signal: this.options.signal });
      const { size } = await stat(temporary);
      const contentLength = response.headers.get("content-encoding") ? null : nonnegativeNumber(response.headers.get("content-length"));
      if (!size || (video.sizeBytes != null && size !== video.sizeBytes) || (contentLength != null && size !== contentLength)) {
        throw new Error("The downloaded video size does not match Drive metadata. Refresh the inventory and retry.");
      }
      await rename(temporary, destination);
    } catch (error) {
      this.options.signal.throwIfAborted();
      if (error instanceof Error && error.message === "The downloaded video size does not match Drive metadata. Refresh the inventory and retry.") throw error;
      throw new Error("Google Drive download failed or was interrupted. No partial video was saved; retry to download again.");
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

/** Starts only when the explicit authorize command is called; never opens a browser. */
export async function authorizeDrive(authFile: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const { clientId, clientSecret } = credentials();
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const timeout = new AbortController();
  const combined = AbortSignal.any([signal, timeout.signal]);
  const timer = setTimeout(() => timeout.abort(new Error("Google authorization timed out after five minutes. Run the authorize command again.")), 300_000);
  let active = false;
  let resolveAuthorization!: () => void;
  let rejectAuthorization!: (error: Error) => void;
  const authorization = new Promise<void>((resolve, reject) => { resolveAuthorization = resolve; rejectAuthorization = reject; });
  // The listener can reject while startup is pending; attach a handler immediately.
  void authorization.catch(() => {});
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    let callback: URL;
    try { callback = new URL(request.url ?? "", DRIVE_AUTH_REDIRECT_URI); }
    catch { response.writeHead(400).end("Invalid callback."); return; }
    if (request.method !== "GET" || callback.pathname !== "/oauth/callback") { response.writeHead(404).end("Not found."); return; }
    if (callback.searchParams.get("state") !== state) { response.writeHead(400).end("Invalid authorization state."); return; }
    if (active) { response.writeHead(409).end("Authorization is already being processed."); return; }
    active = true;
    const code = callback.searchParams.get("code");
    if (!code || callback.searchParams.has("error")) {
      response.writeHead(400).end("Authorization was not granted. Return to the terminal and retry.");
      rejectAuthorization(new Error("Google authorization was not granted. Run the authorize command again."));
      return;
    }
    void (async () => {
      try {
        const token = await tokenRequest(new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          code_verifier: verifier,
          grant_type: "authorization_code",
          redirect_uri: DRIVE_AUTH_REDIRECT_URI,
        }), combined);
        if (!token.refresh_token) throw new Error("Google did not return a refresh token. Revoke this app's access in your Google account and run the authorize command again.");
        combined.throwIfAborted();
        await saveAuthorization(authFile, token.refresh_token);
        response.end("Google Drive authorization saved. You can close this tab and return to the terminal.");
        resolveAuthorization();
      } catch {
        response.writeHead(400).end("Could not save authorization. Return to the terminal and retry.");
        rejectAuthorization(new Error("Google authorization exchange or save failed. Check the OAuth redirect URI and authorization file permissions, then retry."));
      }
    })();
  });
  const abort = () => rejectAuthorization(new Error(signal.aborted ? "Google authorization was cancelled." : "Google authorization timed out after five minutes. Run the authorize command again."));
  combined.addEventListener("abort", abort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", () => reject(new Error(`Cannot start the Google authorization callback on ${DRIVE_AUTH_REDIRECT_URI}. Check whether port 53682 is already in use.`)));
      server.listen(53682, "127.0.0.1", resolve);
    });
    combined.throwIfAborted();
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: DRIVE_AUTH_REDIRECT_URI,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/drive.readonly",
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      ...(process.env.ALLOWED_GOOGLE_EMAIL?.trim() ? { login_hint: process.env.ALLOWED_GOOGLE_EMAIL.trim() } : {}),
    }).toString();
    console.log(url.toString());
    await authorization;
  } finally {
    clearTimeout(timer);
    combined.removeEventListener("abort", abort);
    timeout.abort();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
