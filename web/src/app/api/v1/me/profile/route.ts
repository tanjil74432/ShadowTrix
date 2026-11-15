import { apiHandler, readJson } from "@/server/http/handler";
import { requireApiUser } from "@/server/modules/auth/dal";
import { profileSchema } from "@/server/modules/events/event.schema";
import { updateOwnProfile } from "@/server/modules/auth/profile.service";

/** Update the signed-in user's own name and bio. The id always comes from the session, never from the request. */
export const PATCH = apiHandler(async (req) => {
  const user = await requireApiUser();
  const input = await readJson(req, profileSchema);
  return Response.json(await updateOwnProfile(user.id, input));
});
