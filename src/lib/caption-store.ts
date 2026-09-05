import { createHash } from "node:crypto";
import type { NeonQueryFunction } from "@neondatabase/serverless";

import { prepareCaptions } from "./caption-cues";

export const CAPTION_INDEX_VERSION = 1;
const INSERT_BATCH_SIZE = 2_000;
const MAX_CUE_GAP_SECONDS = 1.5;

export class CaptionConflictError extends Error {
  constructor() {
    super("This caption track changed after it was reviewed. Reload it before replacing it.");
    this.name = "CaptionConflictError";
  }
}

export type CaptionSql = NeonQueryFunction<false, false>;
export type PreparedCaptions = ReturnType<typeof prepareCaptions>;

export function buildCaptionIndex(cues: PreparedCaptions["cues"]) {
  return cues.map((cue, cueIndex) => {
    const next = cues[cueIndex + 1];
    const includeNext = next && next.startSeconds - cue.endSeconds <= MAX_CUE_GAP_SECONDS;
    return {
      cueIndex,
      startSeconds: cue.startSeconds,
      endSeconds: cue.endSeconds,
      text: cue.text,
      searchText: includeNext ? `${cue.text} ${next.text}` : cue.text,
      searchEndSeconds: includeNext ? next.endSeconds : cue.endSeconds,
    };
  });
}

export type SaveCaptionInput = {
  videoId: string;
  fileName?: string | null;
  content: string;
  language?: string;
  label?: string;
  /** undefined: replace; null: require absent; string: require this current MD5. */
  expectedContentHash?: string | null;
};

/** Save the normalized track and its index together, through one HTTP transaction. */
export async function saveCaptionTrack(sql: CaptionSql, input: SaveCaptionInput) {
  const prepared = prepareCaptions(input.content);
  const index = buildCaptionIndex(prepared.cues);
  const contentHash = createHash("md5").update(prepared.content).digest("hex");
  const queries = [
    // Serialize saves/deletes even for tracks that do not exist yet. The next
    // statement gets a fresh READ COMMITTED snapshot after acquiring this lock.
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.videoId}, 0))`,
  ];

  if (input.expectedContentHash !== undefined) {
    // A failed comparison must abort inside Postgres, before any mutation. A
    // post-transaction JS assertion would be too late to prevent overwriting.
    queries.push(sql`
      SELECT 1 / CASE WHEN
        (${input.expectedContentHash}::text IS NULL AND NOT EXISTS (
          SELECT 1 FROM video_captions WHERE video_id = ${input.videoId}
        )) OR EXISTS (
          SELECT 1 FROM video_captions
          WHERE video_id = ${input.videoId} AND md5(content) = ${input.expectedContentHash}
        ) THEN 1 ELSE 0 END AS caption_unchanged
    `);
  }

  queries.push(sql`
    INSERT INTO video_captions
      (video_id, file_name, content, cue_count, last_cue_end_seconds, language, label, index_version)
    VALUES (${input.videoId}, ${input.fileName ?? null}, ${prepared.content}, ${prepared.cueCount},
      ${prepared.lastCueEndSeconds}, ${input.language ?? "en"}, ${input.label ?? "English"}, ${CAPTION_INDEX_VERSION})
    ON CONFLICT (video_id) DO UPDATE SET
      file_name = EXCLUDED.file_name, content = EXCLUDED.content,
      cue_count = EXCLUDED.cue_count, last_cue_end_seconds = EXCLUDED.last_cue_end_seconds,
      language = EXCLUDED.language, label = EXCLUDED.label,
      index_version = EXCLUDED.index_version, updated_at = now()
  `);
  queries.push(sql`DELETE FROM video_caption_cues WHERE video_id = ${input.videoId}`);

  for (let offset = 0; offset < index.length; offset += INSERT_BATCH_SIZE) {
    const batch = JSON.stringify(index.slice(offset, offset + INSERT_BATCH_SIZE));
    queries.push(sql`
      INSERT INTO video_caption_cues
        (video_id, cue_index, start_seconds, end_seconds, text, search_text, search_end_seconds)
      SELECT ${input.videoId}, cue."cueIndex", cue."startSeconds", cue."endSeconds",
        cue.text, cue."searchText", cue."searchEndSeconds"
      FROM jsonb_to_recordset(${batch}::jsonb) AS cue(
        "cueIndex" integer, "startSeconds" double precision, "endSeconds" double precision,
        text text, "searchText" text, "searchEndSeconds" double precision
      )
    `);
  }

  try {
    await sql.transaction(queries, { isolationLevel: "ReadCommitted" });
  } catch (error) {
    if (input.expectedContentHash !== undefined && (error as { code?: string })?.code === "22012") {
      throw new CaptionConflictError();
    }
    throw error;
  }
  return {
    cueCount: prepared.cueCount,
    lastCueEndSeconds: prepared.lastCueEndSeconds,
    contentHash,
    indexVersion: CAPTION_INDEX_VERSION,
  };
}

/** The foreign key removes every derived cue in the same transaction. */
export async function deleteCaptionTrack(sql: CaptionSql, videoId: string) {
  await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${videoId}, 0))`,
    sql`DELETE FROM video_captions WHERE video_id = ${videoId}`,
  ]);
}
