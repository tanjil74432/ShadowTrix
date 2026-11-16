import { apiHandler, readJson } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { createTeamSchema } from "@/server/modules/teams/teams.schema";
import { createTeam } from "@/server/modules/teams/teams.service";

/** Create a team for a team event. The creator becomes its leader. */
export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  const input = await readJson(req, createTeamSchema);
  const team = await createTeam(actor, await eventId(ctx), input);
  return Response.json({ id: team.id, name: team.name }, { status: 201 });
});
