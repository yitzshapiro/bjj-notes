import { NextResponse } from "next/server";
import { DrizzleQueryError } from "drizzle-orm/errors";

import { auth } from "@/auth";
import { GoogleDriveError } from "@/lib/drive";
import { ValidationError } from "@/lib/validation";

export class AuthRequiredError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export async function requireAuth() {
  const session = await auth();
  const expectedEmail = process.env.ALLOWED_GOOGLE_EMAIL?.trim().toLowerCase();
  const actualEmail = session?.user?.email?.trim().toLowerCase();

  if (!expectedEmail || !actualEmail || expectedEmail !== actualEmail) {
    throw new AuthRequiredError();
  }

  return session;
}

export function apiError(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (error instanceof GoogleDriveError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof DrizzleQueryError) {
    console.error("Database query failed", error.cause ?? error);
    return NextResponse.json(
      { error: "Database query failed. Check the Neon connection and applied migrations." },
      { status: 500 },
    );
  }

  console.error(error);
  return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
}
