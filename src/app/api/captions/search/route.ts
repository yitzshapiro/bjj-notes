import { NextResponse, type NextRequest } from "next/server";

import { sql } from "@/db";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { CaptionSearchInputError, parseCaptionSearchParams, searchCaptions } from "@/lib/caption-search";

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const input = parseCaptionSearchParams(request.nextUrl.searchParams);
    const results = await searchCaptions(sql, input);
    return NextResponse.json(results, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CaptionSearchInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return apiError(error);
  }
}
