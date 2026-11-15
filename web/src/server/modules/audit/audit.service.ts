import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { redact } from "@/server/logging/logger";

type Db = Pick<Prisma.TransactionClient, "auditLog">;

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Append-only security/audit trail. Values pass through the redactor so a careless caller cannot
 * persist a token or hash. Accepts a transaction client so the entry commits atomically with the change.
 */
export async function writeAudit(entry: AuditEntry, db: Db = getDb()): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before === undefined ? undefined : (redact(entry.before) as Prisma.InputJsonValue),
      after: entry.after === undefined ? undefined : (redact(entry.after) as Prisma.InputJsonValue),
    },
  });
}
