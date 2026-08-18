/**
 * Seeds the "Pull Guard → Offensive Round" game plan.
 *
 * Every step is matched to an existing division by (video path, start time), so
 * the script never invents a timestamp — if a division has moved or is missing,
 * the run fails loudly instead of writing a broken plan.
 *
 * Usage: pnpm seed:guard-path [--apply]
 */
import { loadEnvConfig } from "@next/env";
import { and, asc, eq, isNull } from "drizzle-orm";

loadEnvConfig(process.cwd());

type Role = "entry" | "control" | "attack" | "recovery" | "concept";

type SeedStep = {
  /** Folder name directly containing the video, from the Drive path. */
  folder: string;
  /** Exact video file name. */
  video: string;
  /** Division start, as "M:SS" or "H:MM:SS" — must already exist in the library. */
  at: string;
  role: Role;
};

type SeedStage = {
  name: string;
  timeframe: string;
  intent: string;
  matTest?: string;
  steps: SeedStep[];
};

const PLAN = {
  slug: "guard-pull-offense",
  name: "Pull Guard → Offensive Round",
  goal: "Arrive on the floor already attacking. Seven stages from the grip that starts the pull through to the submission that makes a sweep unanswerable.",
};

const F2F_PULL = "Volume 3";
const F2F_STAND = "Volume 1 - Fundamental Standing Skills";
const OG1 = "Open Guard Volume 1 - The Two Foundations of Guard Play";
const OG2 = "Open Guard Volume 2 - Sweeps & Reversals";
const RETENTION = "Guard Retention";
const TRIANGLES = "Triangles";

const STAGES: SeedStage[] = [
  {
    name: "The pull is an attack, not a retreat",
    timeframe: "Weeks 1–2",
    intent:
      "A pull that leads to a defensive round almost always happens before a grip is established, so you arrive already conceding. Pick the grip first and the pull becomes a delivery system.",
    matTest:
      "Pull only with a named grip for two weeks. If you cannot name the grip as you sit, stay standing. Log which of the four you actually get.",
    steps: [
      { folder: F2F_PULL, video: "Volume 1 - Introduction, Grips for Rolling Knee Bar, Pulling Guard.mp4", at: "45:21", role: "concept" },
      { folder: F2F_PULL, video: "Volume 1 - Introduction, Grips for Rolling Knee Bar, Pulling Guard.mp4", at: "26:22", role: "entry" },
      { folder: F2F_PULL, video: "Volume 1 - Introduction, Grips for Rolling Knee Bar, Pulling Guard.mp4", at: "32:56", role: "entry" },
      { folder: F2F_PULL, video: "Volume 1 - Introduction, Grips for Rolling Knee Bar, Pulling Guard.mp4", at: "38:52", role: "entry" },
      { folder: F2F_PULL, video: "Volume 1 - Introduction, Grips for Rolling Knee Bar, Pulling Guard.mp4", at: "41:38", role: "entry" },
      { folder: F2F_STAND, video: "Volume 3 - Motion, Kuzushi, Position.mp4", at: "69:09", role: "concept" },
      { folder: F2F_STAND, video: "Volume 3 - Motion, Kuzushi, Position.mp4", at: "71:22", role: "concept" },
    ],
  },
  {
    name: "Pull straight into the sweep",
    timeframe: "Weeks 3–4",
    intent:
      "The most direct answer to the problem: you never play guard at all, the pull is the sweep, and you arrive on top. The highest-leverage volume in the library for this.",
    matTest:
      "Pick one — X guard or double kouchi, not both. Ten pulls a session into that single sweep until it lands on a resisting partner.",
    steps: [
      { folder: F2F_PULL, video: "Volume 2 - Pulling to a Sweep.mp4", at: "0:00", role: "attack" },
      { folder: F2F_PULL, video: "Volume 2 - Pulling to a Sweep.mp4", at: "22:54", role: "attack" },
      { folder: F2F_PULL, video: "Volume 2 - Pulling to a Sweep.mp4", at: "35:33", role: "attack" },
      { folder: F2F_PULL, video: "Volume 2 - Pulling to a Sweep.mp4", at: "51:57", role: "attack" },
      { folder: F2F_PULL, video: "Volume 2 - Pulling to a Sweep.mp4", at: "63:12", role: "attack" },
      { folder: F2F_PULL, video: "Volume 2 - Pulling to a Sweep.mp4", at: "99:47", role: "attack" },
    ],
  },
  {
    name: "When the sweep isn't there, pull to advantage",
    timeframe: "Weeks 5–6",
    intent:
      "The sweep fails against anyone good. This is the fallback layer — pull into a position that already carries a threat, so a failed sweep still leaves you attacking instead of surviving.",
    steps: [
      { folder: F2F_PULL, video: "Volume 3 - Pulling to Advantage.mp4", at: "0:00", role: "concept" },
      { folder: F2F_PULL, video: "Volume 3 - Pulling to Advantage.mp4", at: "8:36", role: "attack" },
      { folder: F2F_PULL, video: "Volume 3 - Pulling to Advantage.mp4", at: "14:46", role: "attack" },
      { folder: F2F_PULL, video: "Volume 3 - Pulling to Advantage.mp4", at: "33:27", role: "control" },
      { folder: F2F_PULL, video: "Volume 3 - Pulling to Advantage.mp4", at: "45:48", role: "attack" },
      { folder: F2F_PULL, video: "Volume 3 - Pulling to Advantage.mp4", at: "60:43", role: "attack" },
    ],
  },
  {
    name: "Make the guard itself offensive",
    timeframe: "Weeks 7–8",
    intent:
      "The theory stage — the one that changes what you are doing in every guard, not only off the pull. Danaher's thesis is two things: connection, and constant threat. A guard without both is a waiting room.",
    matTest:
      "Positional rounds only: start seated, partner kneeling. You win the round by establishing a named grip within five seconds. Nothing else counts.",
    steps: [
      { folder: OG1, video: "Volume 1 - Connection & Grip.mp4", at: "14:07", role: "concept" },
      { folder: OG1, video: "Volume 1 - Connection & Grip.mp4", at: "44:40", role: "concept" },
      { folder: OG1, video: "Volume 1 - Connection & Grip.mp4", at: "52:59", role: "control" },
      { folder: OG1, video: "Volume 2 - Dynamic Energy, Retention, 6 Elements.mp4", at: "0:00", role: "concept" },
      { folder: OG1, video: "Volume 2 - Dynamic Energy, Retention, 6 Elements.mp4", at: "36:10", role: "concept" },
      { folder: OG1, video: "Volume 2 - Dynamic Energy, Retention, 6 Elements.mp4", at: "38:09", role: "concept" },
      { folder: OG1, video: "Volume 5 - Constant Threat, Attack the Legs.mp4", at: "0:00", role: "concept" },
      { folder: OG1, video: "Volume 5 - Constant Threat, Attack the Legs.mp4", at: "4:57", role: "concept" },
    ],
  },
  {
    name: "Three sweeps, not thirty",
    timeframe: "Weeks 9–10",
    intent:
      "The library holds well over a hundred sweeps. Depth beats breadth at every belt below black — pick three that share an entry and let the shared grip do the work.",
    steps: [
      { folder: OG2, video: "Volume 2 - Wrestling Reversals 1.mp4", at: "26:21", role: "attack" },
      { folder: OG2, video: "Volume 2 - Wrestling Reversals 1.mp4", at: "71:49", role: "attack" },
      { folder: OG2, video: "Volume 2 - Wrestling Reversals 1.mp4", at: "52:00", role: "concept" },
      { folder: OG2, video: "Volume 3 - Wrestling Reversals 2.mp4", at: "0:00", role: "attack" },
      { folder: OG2, video: "Volume 3 - Wrestling Reversals 2.mp4", at: "63:19", role: "attack" },
      { folder: OG2, video: "Volume 4 - Sumi Gaeshi.mp4", at: "3:48", role: "attack" },
      { folder: OG2, video: "Volume 4 - Sumi Gaeshi.mp4", at: "26:19", role: "control" },
    ],
  },
  {
    name: "Attach a submission so the sweep becomes a dilemma",
    timeframe: "Weeks 11–12",
    intent:
      "A sweep alone gets defended. A sweep that punishes the defence with a strangle is what makes a guard offensive — the opponent has to be wrong somewhere. Every entry here comes off the 2-on-1 from stage 4.",
    steps: [
      { folder: OG2, video: "Volume 5 - Upper Body Submissions, Triangle Entries, Clamp.mp4", at: "4:29", role: "attack" },
      { folder: OG2, video: "Volume 5 - Upper Body Submissions, Triangle Entries, Clamp.mp4", at: "35:05", role: "control" },
      { folder: OG2, video: "Volume 5 - Upper Body Submissions, Triangle Entries, Clamp.mp4", at: "49:29", role: "attack" },
      { folder: TRIANGLES, video: "Volume 2 - Front Triangle Part 1.mp4", at: "47:26", role: "entry" },
      { folder: TRIANGLES, video: "Volume 2 - Front Triangle Part 1.mp4", at: "52:36", role: "control" },
      { folder: F2F_PULL, video: "Volume 5 - Submission Off the Pull, Guard Pull Negation.mp4", at: "45:37", role: "attack" },
      { folder: F2F_PULL, video: "Volume 5 - Submission Off the Pull, Guard Pull Negation.mp4", at: "107:29", role: "attack" },
    ],
  },
  {
    name: "The tax: don't lose the guard you pulled",
    timeframe: "Ongoing",
    intent:
      "Runs in parallel with everything above, ten minutes a session. No offensive guard survives without retention, and this set is organised around the four passes you will actually meet.",
    steps: [
      { folder: RETENTION, video: "Volume 2 - The Big Picture.mp4", at: "20:13", role: "concept" },
      { folder: RETENTION, video: "Volume 2 - The Big Picture.mp4", at: "26:01", role: "concept" },
      { folder: RETENTION, video: "Volume 3 - Movement-Seated Position.mp4", at: "8:52", role: "recovery" },
      { folder: RETENTION, video: "Volume 3 - Movement-Seated Position.mp4", at: "21:55", role: "recovery" },
      { folder: RETENTION, video: "Volume 5 - Connection.mp4", at: "6:26", role: "concept" },
      { folder: RETENTION, video: "Volume 5 - Connection.mp4", at: "49:14", role: "concept" },
      { folder: RETENTION, video: "Volume 7 - Toreando Guard Pass Retention, Knee Slice Pass Retention.mp4", at: "0:00", role: "recovery" },
      { folder: RETENTION, video: "Volume 7 - Toreando Guard Pass Retention, Knee Slice Pass Retention.mp4", at: "26:53", role: "recovery" },
    ],
  },
];

function parseTime(value: string) {
  const parts = value.split(":").map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  throw new Error(`Invalid timestamp: ${value}`);
}

async function main() {
  const apply = process.argv.includes("--apply");

  const { db } = await import("../src/db/index");
  const { driveItems, gamePlans, planStages, planSteps, videoSections } = await import(
    "../src/db/schema"
  );

  const videos = await db
    .select({ id: driveItems.id, name: driveItems.name, path: driveItems.path })
    .from(driveItems)
    .where(and(eq(driveItems.itemType, "video"), isNull(driveItems.deletedAt)));

  // Resolve every step against a real division before writing anything.
  const resolved: {
    stage: SeedStage;
    steps: { seed: SeedStep; videoId: string; sectionId: string; label: string; startSeconds: number }[];
  }[] = [];

  const problems: string[] = [];

  for (const stage of STAGES) {
    const steps: (typeof resolved)[number]["steps"] = [];

    for (const seed of stage.steps) {
      const matches = videos.filter(
        (video) => video.name === seed.video && video.path.at(-2) === seed.folder,
      );
      if (matches.length !== 1) {
        problems.push(
          `${seed.folder} / ${seed.video} matched ${matches.length} videos instead of 1`,
        );
        continue;
      }

      const startSeconds = parseTime(seed.at);
      const [section] = await db
        .select()
        .from(videoSections)
        .where(eq(videoSections.videoId, matches[0].id))
        .orderBy(asc(videoSections.startSeconds))
        .then((rows) => rows.filter((row) => Math.abs(row.startSeconds - startSeconds) < 1));

      if (!section) {
        problems.push(`No division at ${seed.at} in ${seed.video}`);
        continue;
      }

      steps.push({
        seed,
        videoId: matches[0].id,
        sectionId: section.id,
        label: section.label,
        startSeconds: section.startSeconds,
      });
    }

    resolved.push({ stage, steps });
  }

  if (problems.length) {
    throw new Error(`Could not resolve ${problems.length} step(s):\n  - ${problems.join("\n  - ")}`);
  }

  const total = resolved.reduce((sum, stage) => sum + stage.steps.length, 0);
  console.log(`Resolved ${total} divisions across ${resolved.length} stages.\n`);
  for (const [index, entry] of resolved.entries()) {
    console.log(`${String(index + 1).padStart(2, "0")}. ${entry.stage.name} (${entry.steps.length})`);
    for (const step of entry.steps) {
      const minutes = Math.floor(step.startSeconds / 60);
      const seconds = Math.round(step.startSeconds % 60);
      console.log(
        `      ${String(minutes).padStart(3)}:${String(seconds).padStart(2, "0")}  ${step.label}  [${step.seed.role}]`,
      );
    }
  }

  if (!apply) {
    console.log("\nDry run only. Add --apply to write the plan.");
    return;
  }

  // Replace the plan wholesale so re-running is idempotent. Cascades clear the
  // old stages and steps; nothing on video_sections is touched, so reps survive.
  await db.delete(gamePlans).where(eq(gamePlans.slug, PLAN.slug));

  const [plan] = await db
    .insert(gamePlans)
    .values({ slug: PLAN.slug, name: PLAN.name, goal: PLAN.goal, sortOrder: 0 })
    .returning();

  for (const [stageIndex, entry] of resolved.entries()) {
    const [stage] = await db
      .insert(planStages)
      .values({
        planId: plan.id,
        name: entry.stage.name,
        intent: entry.stage.intent,
        matTest: entry.stage.matTest ?? null,
        timeframe: entry.stage.timeframe,
        sortOrder: stageIndex,
      })
      .returning();

    for (const [stepIndex, step] of entry.steps.entries()) {
      await db.insert(planSteps).values({
        stageId: stage.id,
        sectionId: step.sectionId,
        videoId: step.videoId,
        label: step.label,
        startSeconds: step.startSeconds,
        role: step.seed.role,
        sortOrder: stepIndex,
      });
    }
  }

  const written = await db
    .select({ id: planSteps.id })
    .from(planSteps)
    .innerJoin(planStages, eq(planSteps.stageId, planStages.id))
    .where(eq(planStages.planId, plan.id));

  if (written.length !== total) {
    throw new Error(`Verification failed: wrote ${written.length} steps, expected ${total}`);
  }

  console.log(`\nSeeded "${PLAN.name}" — ${resolved.length} stages, ${written.length} divisions.`);
  console.log(`Open it at /plans/${PLAN.slug}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
