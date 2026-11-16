import { apiHandler, readJson } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiPermission } from "@/server/modules/auth/dal";
import * as org from "@/server/modules/organization/organization.service";
import { membershipUpdateSchema } from "@/server/modules/organization/organization.schema";

export const PATCH = apiHandler(async (req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  await org.updateMembership(actor, await uuidParam(ctx, "id", "Membership"), await readJson(req, membershipUpdateSchema));
  return Response.json({ status: "ok" });
});

export const DELETE = apiHandler(async (_req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  await org.deleteMembership(actor, await uuidParam(ctx, "id", "Membership"));
  return Response.json({ status: "ok" });
});
