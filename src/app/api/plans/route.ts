import { asc, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { gamePlans, planStages, planSteps, videoSections } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";

/** Every active plan with enough of a tally to render a card. */
export async function GET() {
  try {
    await requireAuth();

    const rows = await db
      .select({
        plan: gamePlans,
        stages: sql<number>`count(distinct ${planStages.id})`.mapWith(Number),
        steps: sql<number>`count(${planSteps.id})`.mapWith(Number),
        drilled: sql<number>`count(*) filter (where ${videoSections.practiceCount} > 0)`.mapWith(Number),
        reps: sql<number>`coalesce(sum(${videoSections.practiceCount}), 0)`.mapWith(Number),
      })
      .from(gamePlans)
      .leftJoin(planStages, eq(planStages.planId, gamePlans.id))
      .leftJoin(planSteps, eq(planSteps.stageId, planStages.id))
      .leftJoin(videoSections, eq(planSteps.sectionId, videoSections.id))
      .where(isNull(gamePlans.archivedAt))
      .groupBy(gamePlans.id)
      .orderBy(asc(gamePlans.sortOrder), asc(gamePlans.name));

    return NextResponse.json({
      plans: rows.map((row) => ({
        ...row.plan,
        stageCount: row.stages,
        stepCount: row.steps,
        drilledCount: row.drilled,
        reps: row.reps,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
