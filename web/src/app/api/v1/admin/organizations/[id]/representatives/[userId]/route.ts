import { apiHandler } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiPermission } from "@/server/modules/auth/dal";
import * as org from "@/server/modules/organization/organization.service";

export const DELETE = apiHandler(async (_req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  await org.removeRepresentative(actor, await uuidParam(ctx, "id", "Organization"), await uuidParam(ctx, "userId", "Representative"));
  return Response.json({ status: "ok" });
});
