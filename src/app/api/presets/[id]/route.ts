import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { divisionPresets } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { GoogleDriveError } from "@/lib/drive";
import { parseJson, presetUpdateInput } from "@/lib/validation";

export async function PATCH(request: NextRequest, context: RouteContext<"/api/presets/[id]">) {
  try {
    await requireAuth();
    const { id } = await context.params;
    const input = parseJson(presetUpdateInput, await request.json());
    const [preset] = await db
      .update(divisionPresets)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(divisionPresets.id, id))
      .returning();
    if (!preset) throw new GoogleDriveError("Division preset not found", 404);
    return NextResponse.json({ preset });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext<"/api/presets/[id]">) {
  try {
    await requireAuth();
    const { id } = await context.params;
    const [preset] = await db
      .delete(divisionPresets)
      .where(eq(divisionPresets.id, id))
      .returning({ id: divisionPresets.id });
    if (!preset) throw new GoogleDriveError("Division preset not found", 404);
    return NextResponse.json({ deleted: true, id: preset.id });
  } catch (error) {
    return apiError(error);
  }
}
