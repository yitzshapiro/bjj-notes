import { desc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { gameEntries, gameHits } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { GoogleDriveError } from "@/lib/drive";
import { gameHitCreateInput, parseJson } from "@/lib/validation";

/** Log one occasion this technique worked. */
export async function POST(request: NextRequest, context: RouteContext<"/api/game/[id]/hits">) {
  try {
    await requireAuth();
    const { id } = await context.params;
    const input = parseJson(gameHitCreateInput, await request.json().catch(() => ({})));

    const [entry] = await db.select().from(gameEntries).where(eq(gameEntries.id, id)).limit(1);
    if (!entry) throw new GoogleDriveError("That technique is not in your game", 404);

    const [hit] = await db
      .insert(gameHits)
      .values({
        entryId: entry.id,
        context: input.context ?? "live",
        note: input.note ?? null,
        // An explicit date lets a session be logged the morning after.
        hitAt: input.hitAt ? new Date(input.hitAt) : new Date(),
      })
      .returning();

    await db.update(gameEntries).set({ updatedAt: new Date() }).where(eq(gameEntries.id, entry.id));

    return NextResponse.json({ hit }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

/** Undo the most recent hit, for a mistaken tap on the mat. */
export async function DELETE(_request: NextRequest, context: RouteContext<"/api/game/[id]/hits">) {
  try {
    await requireAuth();
    const { id } = await context.params;

    const [latest] = await db
      .select({ id: gameHits.id })
      .from(gameHits)
      .where(eq(gameHits.entryId, id))
      .orderBy(desc(gameHits.hitAt))
      .limit(1);
    if (!latest) throw new GoogleDriveError("There is nothing to undo", 404);

    await db.delete(gameHits).where(eq(gameHits.id, latest.id));
    return NextResponse.json({ deleted: true, id: latest.id });
  } catch (error) {
    return apiError(error);
  }
}
