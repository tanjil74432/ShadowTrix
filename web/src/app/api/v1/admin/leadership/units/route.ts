import { apiHandler, readJson } from "@/server/http/handler";
import { requireApiPermission } from "@/server/modules/auth/dal";
import * as org from "@/server/modules/organization/organization.service";
import { unitSchema } from "@/server/modules/organization/organization.schema";

export const POST = apiHandler(async (req) => {
  const actor = await requireApiPermission("admin:access");
  const u = await org.createUnit(actor, await readJson(req, unitSchema));
  return Response.json({ id: u.id }, { status: 201 });
});
