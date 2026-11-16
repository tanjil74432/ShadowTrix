import { apiHandler, readJson } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { updateTeamSchema } from "@/server/modules/teams/teams.schema";
import { disbandTeam, getTeamForMember, updateTeam } from "@/server/modules/teams/teams.service";

/** Members only (404 for everyone else). Member email addresses are never included. */
export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  return Response.json(await getTeamForMember(actor, await uuidParam(ctx, "teamId", "Team")));
});

export const PATCH = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  const team = await updateTeam(actor, await uuidParam(ctx, "teamId", "Team"), await readJson(req, updateTeamSchema));
  return Response.json({ id: team.id, name: team.name, description: team.description });
});

/** Disband (leader only). */
export const DELETE = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  await disbandTeam(actor, await uuidParam(ctx, "teamId", "Team"));
  return Response.json({ status: "ok" });
});
