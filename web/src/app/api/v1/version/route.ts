import { NextResponse } from "next/server";

/**
 * Which build is running: the Git commit and the deployment environment, so a deployment can be checked against the commit it should contain.
 * Public and read-only. It exposes only these two values, which Vercel sets for every deployment (never a secret), and nothing from the database.
 */
export function GET() {
  return NextResponse.json(
    { commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null, environment: process.env.VERCEL_ENV ?? null },
    { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  );
}
