import { apiHandler } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { cancelTeamRegistration, registerTeam } from "@/server/modules/teams/teams.service";

/** The leader registers the whole team (capacity counts teams). */
export const POST = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  const r = await registerTeam(actor, await uuidParam(ctx, "teamId", "Team"));
  return Response.json({ status: r.status }, { status: r.created ? 201 : 200 });
});

export const DELETE = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  return Response.json({ status: "ok", ...(await cancelTeamRegistration(actor, await uuidParam(ctx, "teamId", "Team"))) });
});
