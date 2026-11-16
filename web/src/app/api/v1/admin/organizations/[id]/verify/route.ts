import { apiHandler, readJson } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiPermission } from "@/server/modules/auth/dal";
import * as org from "@/server/modules/organization/organization.service";
import { verifySchema } from "@/server/modules/organization/organization.schema";

export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  await org.setOrganizationVerified(actor, await uuidParam(ctx, "id", "Organization"), (await readJson(req, verifySchema)).verified);
  return Response.json({ status: "ok" });
});
