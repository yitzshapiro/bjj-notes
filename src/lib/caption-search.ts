import type { CaptionSql } from "./caption-store";
import { normalizeJapaneseTerms } from "../../scripts/lib/subtitle-terminology";

export class CaptionSearchInputError extends Error {}

export function parseCaptionSearchParams(params: URLSearchParams) {
  const query = (params.get("q") ?? "").trim().replace(/\s+/gu, " ");
  if (query.length < 2 || query.length > 120 || !/[\p{L}\p{N}]/u.test(query)) {
    throw new CaptionSearchInputError("Search for 2–120 characters, including at least one letter or number.");
  }
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    if (!/^\d+$/u.test(raw) || Number(raw) < min || Number(raw) > max) {
      throw new CaptionSearchInputError(`${key} must be an integer from ${min} to ${max}.`);
    }
    return Number(raw);
  };
  return {
    query,
    normalizedQuery: normalizeJapaneseTerms(query).text,
    limit: integer("limit", 20, 1, 50),
    offset: integer("offset", 0, 0, 10_000),
  };
}

export type CaptionSearchHit = {
  videoId: string;
  videoName: string;
  path: string[];
  startSeconds: number;
  endSeconds: number;
  snippet: string;
  href: string;
};

/** One indexed SQL statement supplies both the page and its consistent total. */
export async function searchCaptions(sql: CaptionSql, input: ReturnType<typeof parseCaptionSearchParams>) {
  const rows = await sql`
    WITH query AS (
      SELECT plainto_tsquery('simple', ${input.normalizedQuery}) AS terms,
        phraseto_tsquery('simple', ${input.normalizedQuery}) AS phrase
    ), matching AS MATERIALIZED (
      SELECT cue.*, video.name AS video_name, video.path, query.terms, query.phrase
      FROM video_caption_cues cue
      JOIN drive_items video ON video.id = cue.video_id
      CROSS JOIN query
      WHERE cue.search_vector @@ query.terms
        AND video.item_type = 'video' AND video.deleted_at IS NULL
    ), evaluated AS (
      SELECT matched.*,
        matched.own_vector @@ matched.terms AS own_match,
        matched.own_vector @@ matched.phrase AS own_phrase,
        matched.search_vector @@ matched.phrase AS pair_phrase,
        coalesce(next.own_vector @@ matched.terms, false) AS next_match,
        coalesce(next.own_vector @@ matched.phrase, false) AS next_phrase
      FROM matching matched
      LEFT JOIN video_caption_cues next
        ON next.video_id = matched.video_id AND next.cue_index = matched.cue_index + 1
        AND next.end_seconds = matched.search_end_seconds
    ), anchored AS (
      SELECT *, ((pair_phrase AND NOT own_phrase AND NOT next_phrase) OR NOT own_match) AS use_pair
      FROM evaluated
      -- A match only in the look-ahead cue belongs to that cue's own timestamp.
      -- Keep a true boundary-spanning phrase even if the next cue also contains
      -- its individual words in another order.
      WHERE own_match OR (pair_phrase AND NOT next_phrase) OR NOT next_match
    ), hits AS MATERIALIZED (
      SELECT video_id, video_name, path, cue_index, start_seconds,
        CASE WHEN use_pair THEN search_end_seconds ELSE end_seconds END AS end_seconds,
        CASE WHEN use_pair THEN search_text ELSE text END AS snippet,
        CASE WHEN use_pair THEN pair_phrase ELSE own_phrase END AS phrase_match,
        ts_rank_cd(CASE WHEN use_pair THEN search_vector ELSE own_vector END, terms) AS rank
      FROM anchored
    ), page AS (
      SELECT * FROM hits
      ORDER BY phrase_match DESC, rank DESC, video_name, video_id, cue_index
      LIMIT ${input.limit} OFFSET ${input.offset}
    )
    SELECT (SELECT count(*)::integer FROM hits) AS total,
      coalesce((SELECT jsonb_agg(jsonb_build_object(
        'videoId', video_id, 'videoName', video_name, 'path', path,
        'startSeconds', start_seconds, 'endSeconds', end_seconds,
        'snippet', left(snippet, 360)
      ) ORDER BY phrase_match DESC, rank DESC, video_name, video_id, cue_index) FROM page), '[]'::jsonb) AS results
  `;
  const total = Number(rows[0]?.total ?? 0);
  const results = (rows[0]?.results ?? []) as Omit<CaptionSearchHit, "href">[];
  return {
    ...input,
    total,
    nextOffset: input.offset + results.length < total && input.offset + input.limit <= 10_000
      ? input.offset + input.limit : null,
    results: results.map((hit) => ({
      ...hit,
      href: `/library/${encodeURIComponent(hit.videoId)}?t=${hit.startSeconds}`,
    })),
  };
}
