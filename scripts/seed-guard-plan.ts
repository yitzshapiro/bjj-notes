/**
 * Seeds the "In Guard → Immediate Attack" game plan.
 *
 * Every step is matched to an existing division by (video path, start time), so
 * the script never invents a timestamp — if a division has moved or is missing,
 * the run fails loudly instead of writing a broken plan.
 *
 * Usage: pnpm seed:guard-path [--apply]
 */
import { loadEnvConfig } from "@next/env";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

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
  slug: "guard-attack-system",
  name: "In Guard → Immediate Attack",
  goal: "However you got there — swept, stuffed on a shot, out of a scramble, or off a pull — guard is a position you attack from on arrival. Seven stages from the first three seconds to the submission that makes a sweep unanswerable.",
};

/** Superseded by the plan above; removed on apply so it does not linger. */
const REPLACED_SLUGS = ["guard-pull-offense"];

const OG1 = "Open Guard Volume 1 - The Two Foundations of Guard Play";
const GFF_OG = "Open Guard";
const GFF_CG = "Closed Guard";
const NOGI_HG = "No-Gi Half Guard - 3 Directions of Attack";
const OG2 = "Open Guard Volume 2 - Sweeps & Reversals";
const RETENTION = "Guard Retention";
const TRIANGLES = "Triangles";

const STAGES: SeedStage[] = [
  {
    name: "The first three seconds",
    timeframe: "Weeks 1–2",
    intent:
      "Whatever put you on the bottom, the opening move is the same: get a connection and a grip before your opponent gets theirs. Whoever grips first dictates the exchange, and everything later in this plan assumes you won that moment.",
    matTest:
      "For two weeks the only thing you judge is whether you have a named grip within three seconds of your back touching the mat. Not the sweep, not the submission — the grip.",
    steps: [
      { folder: OG1, video: "Volume 1 - Connection & Grip.mp4", at: "14:07", role: "concept" },
      { folder: OG1, video: "Volume 1 - Connection & Grip.mp4", at: "44:40", role: "concept" },
      { folder: OG1, video: "Volume 1 - Connection & Grip.mp4", at: "52:59", role: "control" },
      { folder: GFF_OG, video: "Volume 2 - Balancing Retention & Offense.mp4", at: "47:37", role: "concept" },
      { folder: OG1, video: "Volume 2 - Dynamic Energy, Retention, 6 Elements.mp4", at: "36:10", role: "concept" },
      { folder: OG1, video: "Volume 2 - Dynamic Energy, Retention, 6 Elements.mp4", at: "38:09", role: "concept" },
    ],
  },
  {
    name: "Know which guard you are in",
    timeframe: "Week 3",
    intent:
      "Four situations, four different first moves — closed, half, open in front of you, or someone already working inside your legs. This is the branch point of the whole game plan: naming the position is what turns a scramble into a plan.",
    matTest:
      "Say the position out loud the moment you land in it. If you cannot name it inside a second, that is the hole to work on, not the technique.",
    steps: [
      { folder: GFF_OG, video: "Volume 1 - Introduction & Theory.mp4", at: "19:42", role: "concept" },
      { folder: GFF_OG, video: "Volume 1 - Introduction & Theory.mp4", at: "14:18", role: "concept" },
      { folder: GFF_OG, video: "Volume 1 - Introduction & Theory.mp4", at: "74:46", role: "concept" },
      { folder: GFF_OG, video: "Volume 2 - Balancing Retention & Offense.mp4", at: "0:00", role: "concept" },
      { folder: OG1, video: "Volume 5 - Constant Threat, Attack the Legs.mp4", at: "0:00", role: "concept" },
      { folder: OG1, video: "Volume 5 - Constant Threat, Attack the Legs.mp4", at: "4:57", role: "concept" },
    ],
  },
  {
    name: "Closed guard: break posture, then attack",
    timeframe: "Weeks 4–5",
    intent:
      "If your legs are already locked you have the most control you will get all round. Nothing works until posture is broken, and once it is, the side scissor opens the whole tree.",
    matTest:
      "From closed guard you may only win the round by breaking posture first. If their posture is still up when you attack, that round does not count.",
    steps: [
      { folder: GFF_CG, video: "Volume 2 - Understanding Closed Guard.mp4", at: "31:16", role: "control" },
      { folder: GFF_CG, video: "Volume 2 - Understanding Closed Guard.mp4", at: "71:58", role: "concept" },
      { folder: GFF_CG, video: "Volume 3 - The Side Scissor.mp4", at: "0:00", role: "entry" },
      { folder: GFF_CG, video: "Volume 3 - The Side Scissor.mp4", at: "41:54", role: "attack" },
      { folder: GFF_CG, video: "Volume 3 - The Side Scissor.mp4", at: "51:06", role: "attack" },
      { folder: GFF_CG, video: "Volume 3 - The Side Scissor.mp4", at: "56:17", role: "attack" },
      { folder: GFF_CG, video: "Volume 4 - Top Lock:Armbar.mp4", at: "0:00", role: "control" },
      { folder: GFF_CG, video: "Volume 4 - Top Lock:Armbar.mp4", at: "44:01", role: "attack" },
    ],
  },
  {
    name: "Half guard: three directions of attack",
    timeframe: "Weeks 6–7",
    intent:
      "The guard you land in most often when a pass is half-finished. Danaher's framing is the useful part: half guard attacks in three directions, so being stuck underneath is a choice rather than a fact.",
    matTest:
      "Start every round already in bottom half. You are not allowed to recover full guard — attack from where you are.",
    steps: [
      { folder: NOGI_HG, video: "Volume 1 - Overview.mp4", at: "44:46", role: "concept" },
      { folder: NOGI_HG, video: "Volume 1 - Overview.mp4", at: "63:25", role: "concept" },
      { folder: NOGI_HG, video: "Volume 2 - Making Half Guard Work for You.mp4", at: "0:00", role: "control" },
      { folder: NOGI_HG, video: "Volume 2 - Making Half Guard Work for You.mp4", at: "23:24", role: "concept" },
      { folder: NOGI_HG, video: "Volume 2 - Making Half Guard Work for You.mp4", at: "28:18", role: "attack" },
      { folder: NOGI_HG, video: "Volume 5 - Knee Levers.mp4", at: "0:00", role: "concept" },
      { folder: NOGI_HG, video: "Volume 5 - Knee Levers.mp4", at: "41:12", role: "attack" },
      { folder: NOGI_HG, video: "Volume 5 - Knee Levers.mp4", at: "44:29", role: "attack" },
    ],
  },
  {
    name: "Seated and open guard: constant threat",
    timeframe: "Weeks 8–9",
    intent:
      "Sitting up in front of a standing or kneeling opponent is the most common place to end up and the easiest place to stall. Three reversals that share an entry beat thirty that do not.",
    steps: [
      { folder: GFF_OG, video: "Volume 3 - Practical Application, Attacking on Two Knees, Hook Sweep.mp4", at: "0:00", role: "attack" },
      { folder: GFF_OG, video: "Volume 3 - Practical Application, Attacking on Two Knees, Hook Sweep.mp4", at: "10:06", role: "concept" },
      { folder: OG2, video: "Volume 2 - Wrestling Reversals 1.mp4", at: "26:21", role: "attack" },
      { folder: OG2, video: "Volume 2 - Wrestling Reversals 1.mp4", at: "71:49", role: "attack" },
      { folder: OG2, video: "Volume 3 - Wrestling Reversals 2.mp4", at: "0:00", role: "attack" },
      { folder: OG2, video: "Volume 3 - Wrestling Reversals 2.mp4", at: "63:19", role: "attack" },
      { folder: OG2, video: "Volume 4 - Sumi Gaeshi.mp4", at: "3:48", role: "attack" },
    ],
  },
  {
    name: "Make every sweep a submission threat",
    timeframe: "Weeks 10–11",
    intent:
      "A sweep alone gets defended. A sweep that punishes the defence with a strangle is what makes a guard genuinely offensive — the opponent has to be wrong somewhere. Every entry here comes off the 2-on-1 from stage 1.",
    steps: [
      { folder: OG2, video: "Volume 5 - Upper Body Submissions, Triangle Entries, Clamp.mp4", at: "4:29", role: "attack" },
      { folder: OG2, video: "Volume 5 - Upper Body Submissions, Triangle Entries, Clamp.mp4", at: "35:05", role: "control" },
      { folder: OG2, video: "Volume 5 - Upper Body Submissions, Triangle Entries, Clamp.mp4", at: "49:29", role: "attack" },
      { folder: TRIANGLES, video: "Volume 2 - Front Triangle Part 1.mp4", at: "47:26", role: "entry" },
      { folder: TRIANGLES, video: "Volume 2 - Front Triangle Part 1.mp4", at: "52:36", role: "control" },
      { folder: NOGI_HG, video: "Volume 6 - Elbow Escape, Ude Gatame, Scoop Scorpion.mp4", at: "40:24", role: "attack" },
      { folder: NOGI_HG, video: "Volume 6 - Elbow Escape, Ude Gatame, Scoop Scorpion.mp4", at: "45:43", role: "attack" },
      { folder: NOGI_HG, video: "Volume 6 - Elbow Escape, Ude Gatame, Scoop Scorpion.mp4", at: "50:34", role: "attack" },
    ],
  },
  {
    name: "The tax: don't lose the guard you are in",
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
  await db.delete(gamePlans).where(inArray(gamePlans.slug, [PLAN.slug, ...REPLACED_SLUGS]));

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
