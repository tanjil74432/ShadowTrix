import { apiHandler, readJson } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiPermission } from "@/server/modules/auth/dal";
import * as org from "@/server/modules/organization/organization.service";
import { termUpdateSchema } from "@/server/modules/organization/organization.schema";

export const PATCH = apiHandler(async (req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  await org.updateTerm(actor, await uuidParam(ctx, "id", "Term"), await readJson(req, termUpdateSchema));
  return Response.json({ status: "ok" });
});
