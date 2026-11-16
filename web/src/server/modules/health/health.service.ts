import "server-only";
import { getDb } from "@/server/db/client";
import { getEmailStatus } from "@/server/modules/email/email-config";

/** `email` says whether this deployment can deliver real mail ("not_configured" on a public deployment with an incomplete SMTP setup). It never names variables or values. */
export type HealthReport = { status: "ok" | "degraded"; database: "up" | "down"; email: "ready" | "not_configured"; time: string };

export async function checkHealth(): Promise<HealthReport> {
  let database: HealthReport["database"] = "down";
  try {
    await getDb().$queryRaw`SELECT 1`;
    database = "up";
  } catch {
    database = "down";
  }
  return { status: database === "up" ? "ok" : "degraded", database, email: getEmailStatus().ready ? "ready" : "not_configured", time: new Date().toISOString() };
}
