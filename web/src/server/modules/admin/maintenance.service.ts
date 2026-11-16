import "server-only";
import { z } from "zod";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/http/errors";
import { stripNul } from "@/lib/sanitize";
import { writeAudit } from "@/server/modules/audit/audit.service";
import type { Actor } from "@/server/modules/authz/permissions";
import { getEmailStatus } from "@/server/modules/email/email-config";
import { assertAdmin, scrubAuditJson } from "./admin-management.service";

/**
 * Application-level maintenance mode: a read-only switch. While on, every state-changing API call from the public is refused with
 * 503, except the ones an administrator needs to sign in, manage the platform and switch it off again (so nobody can lock themselves
 * out). Pages and reads keep working; the scheduler endpoint is unaffected. The state lives in one SiteSetting row.
 */
const KEY = "maintenance_mode";
export const DEFAULT_MESSAGE = "ShadowTrix is in maintenance right now. You can still browse, but changes are paused. Please try again soon.";

export interface MaintenanceState { enabled: boolean; message: string; since: string | null }
const OFF: MaintenanceState = { enabled: false, message: DEFAULT_MESSAGE, since: null };

let cache: { at: number; state: MaintenanceState } | null = null;
const TTL_MS = 5_000;

function parse(value: unknown): MaintenanceState {
  if (!value || typeof value !== "object") return OFF;
  const v = value as Record<string, unknown>;
  return { enabled: v.enabled === true, message: typeof v.message === "string" && v.message ? v.message : DEFAULT_MESSAGE, since: typeof v.since === "string" ? v.since : null };
}

export async function getMaintenanceState(fresh = false): Promise<MaintenanceState> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.state;
  let state = OFF;
  try {
    state = parse((await getDb().siteSetting.findUnique({ where: { key: KEY } }))?.value);
  } catch {
    state = OFF; // never block the platform because the setting could not be read
  }
  cache = { at: Date.now(), state };
  return state;
}

/** Paths an administrator needs while maintenance is on. Everything else that changes state is paused. */
const ALWAYS_ALLOWED = [/^\/api\/v1\/admin\//, /^\/api\/v1\/auth\/(login|logout|me|mfa\/[a-z]+)$/];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function assertNotInMaintenance(req: Request): Promise<void> {
  if (SAFE_METHODS.has(req.method)) return;
  const path = new URL(req.url).pathname;
  if (ALWAYS_ALLOWED.some((r) => r.test(path))) return;
  const s = await getMaintenanceState();
  if (s.enabled) throw new AppError(503, "maintenance", s.message, { "Retry-After": "300" });
}

export const maintenanceSchema = z.object({
  enabled: z.boolean(),
  message: z.string().transform(stripNul).pipe(z.string().trim().min(5, "Write a message of at least 5 characters").max(300)).optional(),
});

export async function setMaintenance(actor: Actor, input: z.infer<typeof maintenanceSchema>) {
  assertAdmin(actor);
  const result = await getDb().$transaction(async (tx) => {
    const before = parse((await tx.siteSetting.findUnique({ where: { key: KEY } }))?.value);
    const next: MaintenanceState = { enabled: input.enabled, message: input.message ?? before.message, since: input.enabled ? (before.enabled ? before.since : new Date().toISOString()) : null };
    await tx.siteSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: next as unknown as object }, update: { value: next as unknown as object } });
    await writeAudit({ actorId: actor.id, action: "maintenance.mode_changed", entityType: "setting", entityId: KEY, before: { enabled: before.enabled }, after: { enabled: next.enabled, message: next.message } }, tx);
    return next;
  });
  cache = { at: Date.now(), state: result };
  return result;
}

/** What an administrator sees: no environment values, only whether each integration is configured and reachable. */
export async function getPlatformStatus(actor: Actor) {
  assertAdmin(actor);
  const db = getDb();
  const env = getEnv();
  let database: { up: boolean; latencyMs: number | null } = { up: false, latencyMs: null };
  const t0 = performance.now();
  try {
    await db.$queryRaw`SELECT 1`;
    database = { up: true, latencyMs: Math.round(performance.now() - t0) };
  } catch {
    database = { up: false, latencyMs: null };
  }
  const email = getEmailStatus();
  const [lastCleanup, pendingDeletions, failedDeletions, pendingUploads, history, state] = await Promise.all([
    db.auditLog.findFirst({ where: { action: "maintenance.cleanup" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, after: true } }),
    db.storageDeletion.count(),
    db.storageDeletion.count({ where: { attempts: { gt: 0 } } }),
    db.pendingUpload.count({ where: { status: "PENDING" } }),
    db.auditLog.findMany({ where: { action: "maintenance.mode_changed" }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, createdAt: true, after: true, actor: { select: { fullName: true } } } }),
    getMaintenanceState(true),
  ]);
  return {
    maintenance: state,
    database,
    storage: { driver: env.STORAGE_DRIVER, configured: env.STORAGE_DRIVER === "local" || !!(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY), pendingDeletions, failedDeletions, pendingUploads },
    email: { ready: email.ready, problems: email.problems },
    scheduler: { endpointEnabled: !!env.CRON_SECRET, lastRunAt: lastCleanup?.createdAt ?? null, lastResult: scrubAuditJson(lastCleanup?.after ?? null) },
    history: history.map((h) => ({ id: h.id, at: h.createdAt, by: h.actor?.fullName ?? "system", details: scrubAuditJson(h.after) })),
  };
}
