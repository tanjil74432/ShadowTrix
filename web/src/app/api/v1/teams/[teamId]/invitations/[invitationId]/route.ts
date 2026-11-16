import { apiHandler } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { revokeInvitation } from "@/server/modules/teams/teams.service";

export const DELETE = apiHandler(async (_req, ctx) => {
  const actor = await requireApiUser();
  await revokeInvitation(actor, await uuidParam(ctx, "teamId", "Team"), await uuidParam(ctx, "invitationId", "Invitation"));
  return Response.json({ status: "ok" });
});
