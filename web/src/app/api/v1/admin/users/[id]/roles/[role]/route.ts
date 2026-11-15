import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { revokeRole } from "@/server/modules/admin/admin-users.service";
import { requireApiPermission } from "@/server/modules/auth/dal";

const params = z.object({
  id: z.uuid(),
  role: z.enum(["PARTICIPANT", "TEAM_LEADER", "ORGANIZER", "JUDGE", "ADMIN"]),
});

export const DELETE = apiHandler(async (_req, ctx) => {
  const actor = await requireApiPermission("users:manage");
  const { id, role } = params.parse(await ctx.params);
  return Response.json(await revokeRole(actor, id, role));
});
