import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { syncDriveLibrary } from "@/lib/drive";

async function syncHandler(request: NextRequest) {
  try {
    await requireAuth();
    return NextResponse.json(await syncDriveLibrary(request));
  } catch (error) {
    return apiError(error);
  }
}

// The Auth.js route wrapper preserves a rotated JWT cookie after token refresh.
export const POST = auth(syncHandler);
