import "server-only";
import { getDb } from "@/server/db/client";

export type HealthReport = { status: "ok" | "degraded"; database: "up" | "down"; time: string };

export async function checkHealth(): Promise<HealthReport> {
  let database: HealthReport["database"] = "down";
  try {
    await getDb().$queryRaw`SELECT 1`;
    database = "up";
  } catch {
    database = "down";
  }
  return { status: database === "up" ? "ok" : "degraded", database, time: new Date().toISOString() };
}
