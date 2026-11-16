import { apiHandler, readJson } from "@/server/http/handler";
import { requireApiPermission } from "@/server/modules/auth/dal";
import * as org from "@/server/modules/organization/organization.service";
import { termSchema } from "@/server/modules/organization/organization.schema";

export const POST = apiHandler(async (req) => {
  const actor = await requireApiPermission("admin:access");
  const t = await org.createTerm(actor, await readJson(req, termSchema));
  return Response.json({ id: t.id }, { status: 201 });
});
