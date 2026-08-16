import { asc } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { divisionPresets } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { parseJson, presetCreateInput } from "@/lib/validation";

export async function GET() {
  try {
    await requireAuth();
    const presets = await db
      .select()
      .from(divisionPresets)
      .orderBy(asc(divisionPresets.sortOrder), asc(divisionPresets.label));
    return NextResponse.json({ presets });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAuth();
    const input = parseJson(presetCreateInput, await request.json());
    const [preset] = await db.insert(divisionPresets).values(input).returning();
    return NextResponse.json({ preset }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
