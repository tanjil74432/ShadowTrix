import { apiHandler, readJson } from "@/server/http/handler";
import { requireApiPermission } from "@/server/modules/auth/dal";
import * as org from "@/server/modules/organization/organization.service";
import { designationSchema } from "@/server/modules/organization/organization.schema";

export const POST = apiHandler(async (req) => {
  const actor = await requireApiPermission("admin:access");
  const d = await org.createDesignation(actor, await readJson(req, designationSchema));
  return Response.json({ id: d.id }, { status: 201 });
});
