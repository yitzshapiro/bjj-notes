import { createHash } from "node:crypto";
import { neon, SqlTemplate, type NeonQueryPromise } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";

import { prepareCaptions } from "./caption-cues";
import { buildCaptionIndex, CaptionConflictError, deleteCaptionTrack, saveCaptionTrack } from "./caption-store";

const srt = "1\n00:00:00,000 --> 00:00:01,200\nEnter ashi\n\n2\n00:00:01,200 --> 00:00:03,000\ngarami here.\n";

function fixture() {
  // Query promises are lazy. Intercepting transaction prevents all networking.
  const sql = neon("postgresql://unused:unused@localhost/unused");
  const transaction = vi.spyOn(sql, "transaction").mockResolvedValue([]);
  const statements = () => (transaction.mock.calls[0][0] as NeonQueryPromise<false, false>[])
    .map((statement) => (statement.queryData as SqlTemplate).toParameterizedQuery());
  return { sql, transaction, statements };
}

describe("caption search index", () => {
  it("retains cue anchors and combines a split phrase only across a short gap", () => {
    const index = buildCaptionIndex([
      { startSeconds: 0, endSeconds: 1.2, text: "Enter ashi" },
      { startSeconds: 1.2, endSeconds: 3, text: "garami here." },
      { startSeconds: 5, endSeconds: 6, text: "Sumi gaeshi." },
    ]);
    expect(index[0]).toMatchObject({ cueIndex: 0, startSeconds: 0, endSeconds: 1.2, searchEndSeconds: 3, searchText: "Enter ashi garami here." });
    expect(index[1]).toMatchObject({ cueIndex: 1, searchEndSeconds: 3, searchText: "garami here." });
    expect(index[2]).toMatchObject({ searchEndSeconds: 6, searchText: "Sumi gaeshi." });
  });

  it("normalizes SRT and publishes track and every cue together", async () => {
    const { sql, transaction, statements } = fixture();
    const prepared = prepareCaptions(srt);
    const result = await saveCaptionTrack(sql, { videoId: "video'1", fileName: "lesson.srt", content: srt });
    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: "ReadCommitted" });
    const queries = statements();
    expect(queries.map((entry) => entry.query.trim().split(/\s+/).slice(0, 3).join(" ")))
      .toEqual(["SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "INSERT INTO video_captions", "DELETE FROM video_caption_cues", "INSERT INTO video_caption_cues"]);
    expect(queries.every((entry) => !entry.query.includes("video'1"))).toBe(true);
    expect(queries[1].params).toContain(prepared.content);
    expect(JSON.parse(queries[3].params[1])).toEqual(buildCaptionIndex(prepared.cues));
    expect(result).toEqual({ cueCount: 2, lastCueEndSeconds: 3, indexVersion: 1, contentHash: createHash("md5").update(prepared.content).digest("hex") });
  });

  it("checks an expected existing or absent track after acquiring the lock and before mutations", async () => {
    for (const expectedContentHash of [null, "abc123"]) {
      const { sql, statements } = fixture();
      await saveCaptionTrack(sql, { videoId: "v", content: srt, expectedContentHash });
      const queries = statements();
      expect(queries[0].query).toContain("pg_advisory_xact_lock");
      expect(queries[1].query).toContain("SELECT 1 / CASE WHEN");
      expect(queries[1].query).toContain("md5(content)");
      expect(queries[1].params).toEqual([expectedContentHash, "v", "v", expectedContentHash]);
      expect(queries[2].query).toContain("INSERT INTO video_captions");
    }
  });

  it("surfaces CAS rollback conflicts without masking unrelated storage failures", async () => {
    const { sql, transaction } = fixture();
    transaction.mockRejectedValueOnce({ code: "22012" });
    await expect(saveCaptionTrack(sql, { videoId: "v", content: srt, expectedContentHash: null })).rejects.toBeInstanceOf(CaptionConflictError);
    const failure = new Error("database unavailable");
    transaction.mockRejectedValueOnce(failure);
    await expect(saveCaptionTrack(sql, { videoId: "v", content: srt })).rejects.toBe(failure);
  });

  it("bounds insert batches without dropping cue indexes", async () => {
    const { sql, statements } = fixture();
    const content = "WEBVTT\n\n" + Array.from({ length: 2_001 }, (_, index) => {
      const time = (seconds: number) => `${String(Math.floor(seconds / 3_600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.000`;
      return `${time(index * 2)} --> ${time(index * 2 + 1)}\nTechnique ${index}.\n`;
    }).join("\n");
    const result = await saveCaptionTrack(sql, { videoId: "v", content });
    expect(result.cueCount).toBe(2_001);
    const batches = statements().filter((entry) => entry.query.includes("jsonb_to_recordset"))
      .map((entry) => JSON.parse(entry.params[1]));
    expect(batches.map((batch) => batch.length)).toEqual([2_000, 1]);
    expect(batches[1][0].cueIndex).toBe(2_000);
  });

  it("does not enter a transaction for malformed captions", async () => {
    const { sql, transaction } = fixture();
    await expect(saveCaptionTrack(sql, { videoId: "v", content: "broken" })).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("serializes caption deletion with saves in one transaction", async () => {
    const { sql, statements } = fixture();
    await deleteCaptionTrack(sql, "v");
    expect(statements().map((entry) => entry.query.trim()))
      .toEqual(["SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "DELETE FROM video_captions WHERE video_id = $1"]);
  });
});
