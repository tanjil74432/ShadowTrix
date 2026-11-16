import { apiHandler, readJson } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { inviteSchema } from "@/server/modules/teams/teams.schema";
import { inviteMember } from "@/server/modules/teams/teams.service";

/** The leader invites an email address. The answer never reveals whether that address has an account. */
export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  const { email } = await readJson(req, inviteSchema);
  const inv = await inviteMember(actor, await uuidParam(ctx, "teamId", "Team"), email);
  return Response.json({ id: inv.id }, { status: 201 });
});
