import { apiHandler, readJson } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiPermission } from "@/server/modules/auth/dal";
import * as org from "@/server/modules/organization/organization.service";
import { membershipSchema } from "@/server/modules/organization/organization.schema";

export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  const m = await org.addMembership(actor, await uuidParam(ctx, "id", "Member"), await readJson(req, membershipSchema));
  return Response.json({ id: m.id }, { status: 201 });
});
