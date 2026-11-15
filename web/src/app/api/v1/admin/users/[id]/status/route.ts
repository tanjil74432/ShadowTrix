import { z } from "zod";
import { apiHandler, readJson } from "@/server/http/handler";
import { setUserStatus } from "@/server/modules/admin/admin-users.service";
import { requireApiPermission } from "@/server/modules/auth/dal";

const body = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) });
const params = z.object({ id: z.uuid() });

export const PATCH = apiHandler(async (req, ctx) => {
  const actor = await requireApiPermission("users:manage");
  const { id } = params.parse(await ctx.params);
  const { status } = await readJson(req, body);
  return Response.json(await setUserStatus(actor, id, status));
});
