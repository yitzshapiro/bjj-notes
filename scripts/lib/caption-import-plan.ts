import { createHash } from "node:crypto";
import path from "node:path";

import type { DriveVideo } from "./subtitle-drive";
import type { SubtitleState } from "./subtitle-storage";

export type CaptionImportVideo = {
  id: string;
  name: string;
  path: string[];
  size_bytes: string | number | null;
  duration_ms: string | number | null;
  drive_modified_at: string | null;
};

export function contentMd5(content: string) {
  return createHash("md5").update(content).digest("hex");
}

/** Generation checkpoints supply exact Drive IDs; filenames are never guessed. */
export function planCaptionImport(state: SubtitleState, inventory: DriveVideo[], videos: CaptionImportVideo[]) {
  const sourceById = new Map(inventory.map((video) => [video.id, video]));
  const appById = new Map(videos.map((video) => [video.id, video]));
  if (sourceById.size !== inventory.length || appById.size !== videos.length) throw new Error("Duplicate video IDs in the inventory.");
  const occupied = new Set<string>();
  const complete = [];
  const incomplete = [];
  for (const [id, progress] of Object.entries(state.videos)) {
    if (!progress.complete) { incomplete.push({ id, output: progress.output, error: progress.error }); continue; }
    const source = sourceById.get(id);
    const video = appById.get(id);
    if (!source || !video) throw new Error(`Completed transcript ${id} has no matching active video and source inventory.`);
    if (source.name !== video.name || JSON.stringify(source.path) !== JSON.stringify(video.path) ||
        source.sizeBytes !== Number(video.size_bytes) ||
        new Date(source.modifiedTime ?? "").getTime() !== new Date(video.drive_modified_at ?? "").getTime()) {
      throw new Error(`Source metadata changed for ${video.name}; refresh and review this transcript before importing.`);
    }
    if (!progress.outputHash || !progress.output || !Number.isFinite(progress.durationSeconds)) {
      throw new Error(`Incomplete output checkpoint for ${video.name}.`);
    }
    const file = path.resolve(progress.output);
    if (occupied.has(file)) throw new Error(`Two videos point at the same caption file: ${file}`);
    occupied.add(file);
    complete.push({ video, source, progress, file });
  }
  return { complete, incomplete };
}
