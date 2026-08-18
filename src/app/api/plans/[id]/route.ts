import { and, asc, eq, isNull, or } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { driveItems, gamePlans, planStages, planSteps, videoSections } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { GoogleDriveError } from "@/lib/drive";
import { isUuid } from "@/lib/validation";

/**
 * One plan with its stages and steps. Each step carries the live division state
 * so the page can show reps and focus without a second round trip; a step whose
 * division was deleted still resolves a deep link from its own columns.
 */
export async function GET(_request: NextRequest, context: RouteContext<"/api/plans/[id]">) {
  try {
    await requireAuth();
    const { id } = await context.params;

    const matchesPlan = isUuid(id) ? or(eq(gamePlans.slug, id), eq(gamePlans.id, id)) : eq(gamePlans.slug, id);
    const [plan] = await db
      .select()
      .from(gamePlans)
      .where(and(matchesPlan, isNull(gamePlans.archivedAt)))
      .limit(1);
    if (!plan) throw new GoogleDriveError("Game plan not found", 404);

    const stages = await db
      .select()
      .from(planStages)
      .where(eq(planStages.planId, plan.id))
      .orderBy(asc(planStages.sortOrder));

    const rows = await db
      .select({
        step: planSteps,
        section: videoSections,
        video: { id: driveItems.id, name: driveItems.name, path: driveItems.path },
      })
      .from(planSteps)
      .innerJoin(planStages, eq(planSteps.stageId, planStages.id))
      .leftJoin(videoSections, eq(planSteps.sectionId, videoSections.id))
      .innerJoin(driveItems, eq(planSteps.videoId, driveItems.id))
      .where(eq(planStages.planId, plan.id))
      .orderBy(asc(planStages.sortOrder), asc(planSteps.sortOrder));

    const steps = rows.map((row) => ({
      ...row.step,
      video: row.video,
      practiceCount: row.section?.practiceCount ?? 0,
      lastPracticedAt: row.section?.lastPracticedAt ?? null,
      focused: row.section?.focused ?? false,
      starred: row.section?.starred ?? false,
      endSeconds: row.section?.endSeconds ?? null,
    }));

    return NextResponse.json({
      plan,
      stages: stages.map((stage) => ({
        ...stage,
        steps: steps.filter((step) => step.stageId === stage.id),
      })),
      totals: {
        steps: steps.length,
        drilled: steps.filter((step) => step.practiceCount > 0).length,
        focused: steps.filter((step) => step.focused).length,
        reps: steps.reduce((sum, step) => sum + step.practiceCount, 0),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
