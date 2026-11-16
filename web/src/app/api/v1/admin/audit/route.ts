import { apiHandler } from "@/server/http/handler";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { auditQuerySchema, listAuditLog } from "@/server/modules/admin/admin-management.service";

/** Audit trail with filters. `view=security` shows authentication, MFA, role and maintenance events. */
export const GET = apiHandler(async (req) => {
  const actor = await requireApiPermission("admin:access");
  return Response.json(await listAuditLog(actor, auditQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))));
});

