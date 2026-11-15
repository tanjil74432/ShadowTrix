import { z } from "zod";
import { apiHandler, readJson } from "@/server/http/handler";
import { grantRole } from "@/server/modules/admin/admin-users.service";
import { requireApiPermission } from "@/server/modules/auth/dal";

const body = z.object({ role: z.enum(["PARTICIPANT", "TEAM_LEADER", "ORGANIZER", "JUDGE", "ADMIN"]) });
const params = z.object({ id: z.uuid() });

export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiPermission("users:manage");
  const { id } = params.parse(await ctx.params);
  const { role } = await readJson(req, body);
  return Response.json(await grantRole(actor, id, role));
});
