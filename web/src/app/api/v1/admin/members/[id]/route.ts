import { apiHandler, readJson } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiPermission } from "@/server/modules/auth/dal";
import * as org from "@/server/modules/organization/organization.service";
import { memberUpdateSchema } from "@/server/modules/organization/organization.schema";

export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  return Response.json(await org.getMember(actor, await uuidParam(ctx, "id", "Member")));
});

export const PATCH = apiHandler(async (req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  await org.updateMember(actor, await uuidParam(ctx, "id", "Member"), await readJson(req, memberUpdateSchema));
  return Response.json({ status: "ok" });
});

export const DELETE = apiHandler(async (_req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  await org.deleteMember(actor, await uuidParam(ctx, "id", "Member"));
  return Response.json({ status: "ok" });
});
