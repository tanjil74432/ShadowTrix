import { apiHandler, readJson } from "@/server/http/handler";
import { requireApiUser } from "@/server/modules/auth/dal";
import { invitationTokenSchema } from "@/server/modules/teams/teams.schema";
import { previewInvitation } from "@/server/modules/teams/teams.service";
import { notFound } from "@/server/http/errors";

/** What an emailed invitation link shows. Only the invited person sees anything; everyone else gets 404. */
export const POST = apiHandler(async (req) => {
  const user = await requireApiUser();
  const { token } = await readJson(req, invitationTokenSchema);
  const preview = await previewInvitation(user, token);
  if (!preview) throw notFound("Invitation");
  return Response.json(preview);
});
