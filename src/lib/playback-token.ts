import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_WINDOW_MS = 12 * 60 * 60 * 1000;

type PlaybackTokenPayload = {
  exp: number;
  sizeBytes: number | null;
  videoId: string;
  version: string;
};

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is required");
  return value;
}

function signature(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createPlaybackToken(input: {
  sizeBytes: number | null;
  videoId: string;
  version: string;
}) {
  // Keep the URL stable inside a 12-hour window so repeated visits can reuse
  // the browser's private media cache.
  const currentWindow = Math.floor(Date.now() / TOKEN_WINDOW_MS);
  const payload: PlaybackTokenPayload = {
    ...input,
    exp: (currentWindow + 2) * TOKEN_WINDOW_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function verifyPlaybackToken(token: string, expectedVideoId: string) {
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra) throw new Error("Invalid playback token");

  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(signature(encoded));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("Invalid playback token");
  }

  let payload: PlaybackTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PlaybackTokenPayload;
  } catch {
    throw new Error("Invalid playback token");
  }

  if (
    payload.videoId !== expectedVideoId ||
    !Number.isFinite(payload.exp) ||
    payload.exp <= Date.now() ||
    (payload.sizeBytes !== null && (!Number.isSafeInteger(payload.sizeBytes) || payload.sizeBytes < 0)) ||
    typeof payload.version !== "string"
  ) {
    throw new Error("Invalid or expired playback token");
  }

  return payload;
}
