import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { gamePlans, planStages, planSteps, videoSections } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { GoogleDriveError } from "@/lib/drive";
import { isUuid, parseJson, stageFocusInput } from "@/lib/validation";

/**
 * Put a whole stage into this week's focus, or take it out. Focus still lives on
 * `video_sections`, so anything moved here also shows up on the focus board.
 */
export async function PUT(request: NextRequest, context: RouteContext<"/api/plans/[id]/focus">) {
  try {
    await requireAuth();
    const { id } = await context.params;
    const input = parseJson(stageFocusInput, await request.json());

    const matchesPlan = isUuid(id) ? or(eq(gamePlans.slug, id), eq(gamePlans.id, id)) : eq(gamePlans.slug, id);
    const [plan] = await db
      .select({ id: gamePlans.id })
      .from(gamePlans)
      .where(and(matchesPlan, isNull(gamePlans.archivedAt)))
      .limit(1);
    if (!plan) throw new GoogleDriveError("Game plan not found", 404);

    const [stage] = await db
      .select({ id: planStages.id })
      .from(planStages)
      .where(and(eq(planStages.id, input.stageId), eq(planStages.planId, plan.id)))
      .limit(1);
    if (!stage) throw new GoogleDriveError("Stage not found in this plan", 404);

    const steps = await db
      .select({ sectionId: planSteps.sectionId })
      .from(planSteps)
      .where(eq(planSteps.stageId, stage.id));

    const sectionIds = steps
      .map((step) => step.sectionId)
      .filter((sectionId): sectionId is string => Boolean(sectionId));
    if (!sectionIds.length) {
      return NextResponse.json({ updated: 0, focused: input.focused });
    }

    const now = new Date();
    const updated = await db
      .update(videoSections)
      .set({
        focused: input.focused,
        focusAddedAt: input.focused ? now : null,
        updatedAt: now,
      })
      .where(inArray(videoSections.id, sectionIds))
      .returning({ id: videoSections.id });

    return NextResponse.json({ updated: updated.length, focused: input.focused });
  } catch (error) {
    return apiError(error);
  }
}
