import { apiHandler } from "@/server/http/handler";
import { requireApiUser } from "@/server/modules/auth/dal";
import { listMyRegistrations } from "@/server/modules/events/registrations.service";

/** The signed-in user's own registrations (never anyone else's). */
export const GET = apiHandler(async () => {
  const user = await requireApiUser();
  return Response.json({ items: await listMyRegistrations(user.id) });
});
