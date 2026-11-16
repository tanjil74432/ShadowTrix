import { apiHandler, readJson } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiPermission } from "@/server/modules/auth/dal";
import * as org from "@/server/modules/organization/organization.service";
import { emailSchema } from "@/server/modules/organization/organization.schema";

export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  const { email } = await readJson(req, emailSchema);
  const r = await org.addRepresentative(actor, await uuidParam(ctx, "id", "Organization"), email);
  return Response.json(r, { status: r.created ? 201 : 200 });
});
