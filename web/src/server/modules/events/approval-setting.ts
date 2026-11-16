import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";

/** Platform setting: when true, organizers can publish an event only after an administrator approved it. Off by default. */
export const APPROVAL_KEY = "event_approval_required";

export async function getApprovalRequired(db: Pick<Prisma.TransactionClient, "siteSetting"> = getDb()): Promise<boolean> {
  return (await db.siteSetting.findUnique({ where: { key: APPROVAL_KEY } }))?.value === true;
}
