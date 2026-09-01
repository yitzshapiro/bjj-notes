/**
 * Corrects two instructional folders whose imported divisions are shifted one
 * chapter late.
 *
 * The source lists for these volumes recorded every chapter boundary but
 * omitted the 0:00 entry, so the importer paired each label with the boundary
 * that actually starts the *next* chapter. The result is an off-by-one: the
 * opening overview sits several minutes in, and every label after it points at
 * the chapter following the one it names.
 *
 * The fix walks each label back one boundary — label 1 to 0:00, label 2 to the
 * old first timestamp, and so on. The old last timestamp stops being a start
 * and becomes the end of the final labelled chapter, leaving the tail after it
 * unnamed. Rows are updated in place so starred/focused/practice state, tags,
 * and My Game entries stay attached to their labels.
 *
 * Usage: pnpm exec tsx scripts/shift-division-starts.ts [--apply]
 */
import { loadEnvConfig } from "@next/env";
import { eq, inArray, isNull, and } from "drizzle-orm";

loadEnvConfig(process.cwd());

/**
 * Folders whose source lists are missing their 0:00 entry. Self Mastery is
 * deliberately absent: its divisions came from a hand-corroborated note rather
 * than one of these lists, so the same shift is not known to apply.
 */
const SHIFTED_FOLDERS = new Set([
  "Volume 1 - Fundamental Standing Skills",
  "Gordon Ryan - Systematically Attacking from Half Guard 720p",
]);

function formatDuration(seconds: number) {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const { db } = await import("../src/db/index");
  const { driveItems, videoSections } = await import("../src/db/schema");

  const rows = await db
    .select({
      id: videoSections.id,
      videoId: videoSections.videoId,
      label: videoSections.label,
      startSeconds: videoSections.startSeconds,
      name: driveItems.name,
      path: driveItems.path,
    })
    .from(videoSections)
    .innerJoin(driveItems, eq(videoSections.videoId, driveItems.id))
    .where(and(eq(driveItems.itemType, "video"), isNull(driveItems.deletedAt)));

  const byVideo = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!SHIFTED_FOLDERS.has(row.path.at(-2) ?? "")) continue;
    const group = byVideo.get(row.videoId) ?? [];
    group.push(row);
    byVideo.set(row.videoId, group);
  }

  if (!byVideo.size) throw new Error("No divisions matched the folders to correct");

  const updates: { id: string; startSeconds: number; endSeconds: number; sortOrder: number }[] = [];
  let skipped = 0;

  for (const group of byVideo.values()) {
    group.sort((a, b) => a.startSeconds - b.startSeconds);

    // Already anchored at 0:00 means the source list kept its opening entry and
    // the labels are not shifted. Leave it alone; re-running stays a no-op.
    if (group[0].startSeconds === 0) {
      skipped += 1;
      continue;
    }

    console.log(`\n${group[0].name}`);
    for (const [index, section] of group.entries()) {
      const startSeconds = index === 0 ? 0 : group[index - 1].startSeconds;
      const endSeconds = section.startSeconds;
      console.log(
        `  ${formatDuration(section.startSeconds).padStart(8)} -> ${formatDuration(startSeconds).padStart(8)}  ${section.label}`,
      );
      updates.push({ id: section.id, startSeconds, endSeconds, sortOrder: index });
    }
  }

  console.log(
    `\n${updates.length} divisions across ${byVideo.size - skipped} videos to shift` +
      (skipped ? ` (${skipped} already start at 0:00, left alone)` : ""),
  );

  if (!apply) {
    console.log("Dry run only. Add --apply to write the corrected times.");
    return;
  }

  for (const update of updates) {
    await db
      .update(videoSections)
      .set({
        startSeconds: update.startSeconds,
        endSeconds: update.endSeconds,
        sortOrder: update.sortOrder,
        updatedAt: new Date(),
      })
      .where(eq(videoSections.id, update.id));
  }

  const stored = await db
    .select({ id: videoSections.id, startSeconds: videoSections.startSeconds })
    .from(videoSections)
    .where(inArray(videoSections.id, updates.map((update) => update.id)));
  const startsById = new Map(stored.map((section) => [section.id, section.startSeconds]));
  const wrong = updates.filter(
    (update) => Math.abs((startsById.get(update.id) ?? NaN) - update.startSeconds) >= 0.001,
  );
  if (wrong.length) throw new Error(`Verification failed: ${wrong.length} divisions did not shift`);

  console.log(`Shift complete and verified: ${updates.length} divisions updated.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
