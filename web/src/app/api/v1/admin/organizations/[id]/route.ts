import { apiHandler, readJson } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiPermission } from "@/server/modules/auth/dal";
import * as org from "@/server/modules/organization/organization.service";
import { organizationUpdateSchema } from "@/server/modules/organization/organization.schema";

export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  return Response.json(await org.getOrganization(actor, await uuidParam(ctx, "id", "Organization")));
});

export const PATCH = apiHandler(async (req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  await org.updateOrganization(actor, await uuidParam(ctx, "id", "Organization"), await readJson(req, organizationUpdateSchema));
  return Response.json({ status: "ok" });
});

export const DELETE = apiHandler(async (_req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  await org.deleteOrganization(actor, await uuidParam(ctx, "id", "Organization"));
  return Response.json({ status: "ok" });
});
