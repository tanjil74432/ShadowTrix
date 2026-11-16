import { apiHandler, readJson } from "@/server/http/handler";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { getPlatformStatus, maintenanceSchema, setMaintenance } from "@/server/modules/admin/maintenance.service";

/** Platform status: database, storage, email readiness, scheduler, maintenance state and history. No environment values. */
export const GET = apiHandler(async () => {
  const actor = await requireApiPermission("admin:access");
  return Response.json(await getPlatformStatus(actor));
});

/** Switch read-only maintenance mode on or off. Administrator and sign-in endpoints stay available while it is on. */
export const PUT = apiHandler(async (req) => {
  const actor = await requireApiPermission("admin:access");
  return Response.json(await setMaintenance(actor, await readJson(req, maintenanceSchema)));
});
