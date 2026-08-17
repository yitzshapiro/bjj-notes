import { readFile } from "node:fs/promises";

import { loadEnvConfig } from "@next/env";
import { and, eq, inArray, isNull } from "drizzle-orm";

loadEnvConfig(process.cwd());

const INSTRUCTIONAL_FOLDERS: Record<string, string> = {
  "Open Guard Vol. 2 — Sweeps & Reversals": "Open Guard Volume 2 - Sweeps & Reversals",
  "Open Guard Vol. 1 — Two Foundations of Guard Play":
    "Open Guard Volume 1 - The Two Foundations of Guard Play",
  "No-Gi Half Guard — 3 Directions of Attack": "No-Gi Half Guard - 3 Directions of Attack",
  "No-Gi Guard Passing": "No-Gi Guard Passing",
  "Mounted Pin Attacks — 4×4 Mount System": "Mounted Pin Attacks - The 4x4 Mount System",
  "A New Philosophy of Submission Escapes": "A New Philosophy Of Submission Escapes",
  "A New Philosophy of Positional Escapes": "A New Philosophy of Positional Escapes",
  "Standing2Ground — Upper Body Takedowns": "Upper Body Takedowns",
  "Triangles — Enter the System": "Triangles",
  "Leglocks — Enter the System": "Leglocks",
  "Kimura — Enter the System": "Kimura",
  "Front Headlock — Enter the System / The Front Headlock System": "Front Headlock",
  "Back Attacks — Enter the System": "Back Attacks",
  "Arm Bars — Enter the System": "Arm Bar",
  "Volume 1 — Fundamental Standing Skills": "Volume 1 - Fundamental Standing Skills",
  "Feet to Floor — Volume 2": "Volume 2",
  "Feet to Floor — Volume 3": "Volume 3",
  "Escapes — Pin Escapes & Turtle Escapes": "Escapes",
  "Guard Retention": "Guard Retention",
  "Half Guard": "Half Guard",
  "Closed Guard": "Closed Guard",
  "Open Guard": "Open Guard",
  "Passing the Guard": "Passing the Guard",
  "Half Guard Passing & Dynamic Pins": "Half Guard Passing and Dynamic Pins",
  "Strangles & Turtle Breakdowns": "Strangles & Turtle Breakdowns",
  "Positional Dominance & Scrimmage Wrestling": "Positional Dominance & Scrimmage Wrestling",
  "Self Mastery — Solo BJJ Training Drills": "Self Mastery Solo BJJ Training Drills",
  "Takedowns & Standing Skills for Jiu Jitsu": "Takedowns & Standing Skills For Jiu Jitsu",
  "The Sport of Kings — High Performance Mindset for Grappling":
    "The.Sport.of.Kings.High.Performance.Mindset.For.Grappling.by.Gordon Ryan.720p.WEB-DL.H264-SZLS",
  "Systematizing Closed Guard": "Systematizing Closed Guard Gordon King Ryan",
  "Systematically Attacking the Back": "Systematically Attacking the Back by Gordon Ryan",
  "Systematically Attacking the Turtle Position": "Gordon Ryan- Systematically Attacking the Turtle Position",
  "Systematically Attacking the Guard": "Gordon Ryan - Systematically Attacking the Guard",
  "Systematically Attacking From Open Guard — Supine":
    "Gordon Ryan - Systematically Attacking From Open Guard Supine Position 720p",
  "Systematically Attacking From Half Guard": "Gordon Ryan - Systematically Attacking from Half Guard 720p",
  "Pillars of Defense — Upper Body Joint Lock Escapes":
    "Gordon Ryan - Pillars of Defense Upper Body Joint Lock Escapes (720p aac)",
  "Getting Swole as a Grappler": "Getting Swole as A Grappler by Gordon Ryan",
};

const SELF_MASTERY = "Self Mastery — Solo BJJ Training Drills";
const SKIPPED_MARKDOWN_INSTRUCTIONALS = new Set([
  "Systematically Attacking From Open Guard — Seated",
  "My Evolution Your Revolution — ADCC 2019 Analysis",
]);

type Division = {
  label: string;
  startSeconds: number;
};

type VolumeDivisions = {
  instructional: string;
  volume: number;
  divisions: Division[];
};

function parseTime(value: string) {
  const parts = value.split(":").map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Invalid timestamp: ${value}`);
  }

  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  throw new Error(`Invalid timestamp: ${value}`);
}

export function parseDivisionFile(source: string): VolumeDivisions[] {
  const groups = new Map<string, VolumeDivisions>();
  const markdownTable = source.includes("| **1** |");
  let instructional = "";
  let volume = 0;

  for (const rawLine of source.replaceAll("\r\n", "\n").split("\n")) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed || line.startsWith("Instructional\t") || trimmed.startsWith("* ") || trimmed.startsWith("† ")) {
      continue;
    }

    if (markdownTable) {
      const heading = trimmed.match(/^##\s+(?:\d+\.\s+)?(.+)$/)?.[1];
      if (heading) {
        if (INSTRUCTIONAL_FOLDERS[heading]) {
          instructional = heading;
          volume = 0;
        } else if (SKIPPED_MARKDOWN_INSTRUCTIONALS.has(heading)) {
          instructional = "";
          volume = 0;
        }
        continue;
      }

      const row = trimmed.match(/^\|\s*\*\*(\d+)\*\*\s*\|\s*(.*?)\s*\|$/);
      if (row && instructional) {
        volume = Number(row[1]);
        const key = `${instructional}\u0000${volume}`;
        const group = groups.get(key) ?? { instructional, volume, divisions: [] };
        for (const entry of row[2].split("<br>")) {
          const match = entry.trim().match(/^`(\d+(?::\d{2}){1,2})`\s+(.+)$/);
          if (!match) throw new Error(`Could not parse Markdown division: ${entry}`);
          if (match[2].includes("†")) continue;
          group.divisions.push({ startSeconds: parseTime(match[1]), label: match[2].trim() });
        }
        groups.set(key, group);
      }
      continue;
    }

    if (INSTRUCTIONAL_FOLDERS[trimmed]) {
      instructional = trimmed;
      volume = 0;
      continue;
    }
    const selfMasteryVolume = instructional === SELF_MASTERY && trimmed.match(/^Volume ([1-4])$/);
    if (selfMasteryVolume) {
      volume = Number(selfMasteryVolume[1]);
      continue;
    }
    if (
      instructional === SELF_MASTERY &&
      trimmed.includes("only start I can corroborate cleanly is 0:00 for Guard Standing Up")
    ) {
      const key = `${instructional}\u0000${volume}`;
      const group = groups.get(key) ?? { instructional, volume, divisions: [] };
      group.divisions.push({ startSeconds: 0, label: "Guard Standing Up" });
      groups.set(key, group);
      continue;
    }
    if (
      trimmed === "Feet to Floor" ||
      trimmed === "Go Further Faster" ||
      trimmed === "Enter the System" ||
      trimmed.startsWith("Vol.\t") ||
      trimmed.startsWith("Part\t") ||
      trimmed.startsWith("Timestamp\t") ||
      trimmed.startsWith("—\t") ||
      trimmed.startsWith("BJJ Fanatics") ||
      trimmed.startsWith("This is ") ||
      trimmed.startsWith("That covers ")
    ) {
      continue;
    }

    let divisionText = trimmed;
    if (line.includes("\t")) {
      const cells = line.split("\t");
      if (/^\d+$/.test(cells[0].trim())) {
        volume = Number(cells[0].trim());
        divisionText = cells.slice(1).join("\t").trim();
      } else if (/^\d+(?::\d{2}){1,2}\*?$/.test(cells[0].trim())) {
        divisionText = `${cells[0].trim()} ${cells.slice(1).join("\t").trim()}`;
      } else {
        const [instructionalCell = "", volumeCell = "", ...divisionCells] = cells;
        if (instructionalCell.trim()) instructional = instructionalCell.trim();
        if (volumeCell.trim()) volume = Number(volumeCell.trim());
        divisionText = divisionCells.join("\t").trim();
      }
    }

    // A dagger marks a timestamp the source itself says is unreliable. Do not
    // invent a corrected time or import a known-bad division.
    if (/^\d+(?::\d{2}){1,2}†\s+/.test(divisionText)) continue;

    const match = divisionText.match(/^(\d+(?::\d{2}){1,2})\*?\s+(.+)$/);
    if (!match) {
      if (
        instructional === SELF_MASTERY ||
        trimmed.startsWith("So at this point ") ||
        trimmed.startsWith("The only meaningful hole ")
      ) {
        continue;
      }
      throw new Error(`Could not parse division line: ${line}`);
    }
    if (!instructional || !Number.isInteger(volume) || volume < 1) {
      throw new Error(`Division is missing an instructional or volume: ${line}`);
    }

    const key = `${instructional}\u0000${volume}`;
    const group = groups.get(key) ?? { instructional, volume, divisions: [] };
    group.divisions.push({ startSeconds: parseTime(match[1]), label: match[2].trim() });
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    for (let index = 1; index < group.divisions.length; index += 1) {
      if (group.divisions[index].startSeconds <= group.divisions[index - 1].startSeconds) {
        throw new Error(
          `${group.instructional} volume ${group.volume} has non-increasing timestamps at ${group.divisions[index].label}`,
        );
      }
    }
  }

  return [...groups.values()];
}

function volumeNumber(name: string) {
  const match = name.match(/\b(?:vol(?:ume)?|part)[\s._-]*(\d+)\b/i);
  if (match) return Number(match[1]);
  const trailing = name.match(/(?:Ryan)?(\d+)(?:\s+\([^)]*\))?\.(?:mp4|mkv)$/i);
  return trailing ? Number(trailing[1]) : null;
}

async function main() {
  const filePath = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  const apply = process.argv.includes("--apply");
  const verify = process.argv.includes("--verify");
  if (!filePath) {
    throw new Error("Usage: pnpm exec tsx scripts/import-divisions.ts <file> [--apply|--verify]");
  }
  if (apply && verify) throw new Error("Choose either --apply or --verify, not both");

  const source = await readFile(filePath, "utf8");
  const omittedUncertain = source
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => /^\d+(?::\d{2}){1,2}†\s+/.test(line.trim())).length +
    [...source.matchAll(/`\d+(?::\d{2}){1,2}`[^<|\n]*†/g)].length;
  const groups = parseDivisionFile(source);
  const unknown = [...new Set(groups.map((group) => group.instructional))].filter(
    (name) => !INSTRUCTIONAL_FOLDERS[name],
  );
  if (unknown.length) throw new Error(`Unknown instructionals: ${unknown.join(", ")}`);

  const dbModule = await import("../src/db/index");
  const schemaModule = await import("../src/db/schema");
  const db = dbModule.db;
  const { driveItems, videoSections } = schemaModule;

  const videos = await db
    .select({ id: driveItems.id, name: driveItems.name, path: driveItems.path })
    .from(driveItems)
    .where(and(eq(driveItems.itemType, "video"), isNull(driveItems.deletedAt)));

  const resolved = groups.map((group) => {
    const folder = INSTRUCTIONAL_FOLDERS[group.instructional];
    const matches = videos.filter(
      (video) => video.path.at(-2) === folder && volumeNumber(video.name) === group.volume,
    );
    if (matches.length !== 1) {
      throw new Error(
        `${group.instructional} volume ${group.volume} matched ${matches.length} videos instead of 1`,
      );
    }
    return { ...group, video: matches[0] };
  });

  const totalDivisions = resolved.reduce((total, group) => total + group.divisions.length, 0);
  console.log(`Validated ${totalDivisions} divisions across ${resolved.length} videos.`);
  if (omittedUncertain) {
    console.log(`Skipped ${omittedUncertain} dagger-marked divisions whose timestamps the source identifies as unreliable.`);
  }
  for (const group of resolved) {
    console.log(`${group.instructional} vol. ${group.volume}: ${group.divisions.length} divisions -> ${group.video.name}`);
  }

  const videoIds = resolved.map((group) => group.video.id);
  if (verify) {
    const stored = await db
      .select({
        videoId: videoSections.videoId,
        label: videoSections.label,
        startSeconds: videoSections.startSeconds,
      })
      .from(videoSections)
      .where(inArray(videoSections.videoId, videoIds));
    const storedKeys = new Set(
      stored.map((section) => `${section.videoId}\u0000${section.startSeconds}\u0000${section.label}`),
    );
    const missing = resolved.flatMap((group) =>
      group.divisions.filter(
        (division) =>
          !storedKeys.has(`${group.video.id}\u0000${division.startSeconds}\u0000${division.label}`),
      ),
    );

    if (missing.length) {
      throw new Error(`Database verification failed: ${missing.length} imported divisions are missing`);
    }
    console.log(`Verified ${totalDivisions} divisions across ${new Set(videoIds).size} videos in the database.`);
    return;
  }

  if (!apply) {
    console.log("Dry run only. Add --apply to write or --verify to check the divisions.");
    return;
  }

  const existing = await db
    .select()
    .from(videoSections)
    .where(inArray(videoSections.videoId, videoIds));

  let inserted = 0;
  let updated = 0;
  for (const group of resolved) {
    for (const [sortOrder, division] of group.divisions.entries()) {
      const endSeconds = group.divisions[sortOrder + 1]?.startSeconds ?? null;
      const current = existing.find(
        (section) =>
          section.videoId === group.video.id &&
          Math.abs(section.startSeconds - division.startSeconds) < 0.001 &&
          section.label === division.label,
      );

      if (current) {
        await db
          .update(videoSections)
          .set({ endSeconds, sortOrder, updatedAt: new Date() })
          .where(eq(videoSections.id, current.id));
        updated += 1;
      } else {
        await db.insert(videoSections).values({
          videoId: group.video.id,
          label: division.label,
          startSeconds: division.startSeconds,
          endSeconds,
          sortOrder,
        });
        inserted += 1;
      }
    }
  }

  console.log(`Import complete: ${inserted} inserted, ${updated} updated.`);

  const stored = await db
    .select({
      videoId: videoSections.videoId,
      label: videoSections.label,
      startSeconds: videoSections.startSeconds,
    })
    .from(videoSections)
    .where(inArray(videoSections.videoId, videoIds));
  const storedKeys = new Set(
    stored.map((section) => `${section.videoId}\u0000${section.startSeconds}\u0000${section.label}`),
  );
  const missing = resolved.flatMap((group) =>
    group.divisions.filter(
      (division) =>
        !storedKeys.has(`${group.video.id}\u0000${division.startSeconds}\u0000${division.label}`),
    ),
  );

  if (missing.length) {
    throw new Error(`Database verification failed: ${missing.length} imported divisions are missing`);
  }
  console.log(`Verified ${totalDivisions} divisions across ${new Set(videoIds).size} videos in the database.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
