import { apiHandler } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { leaveTeam } from "@/server/modules/teams/teams.service";

/** A member leaves voluntarily. */
export const POST = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  await leaveTeam(actor, await uuidParam(ctx, "teamId", "Team"));
  return Response.json({ status: "ok" });
});
