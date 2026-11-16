import { apiHandler, readJson } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { publishAnnouncement, publishSchema } from "@/server/modules/admin/announcements.service";

/** Publishes now, or schedules for a future `at` (ISO date-time). */
export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  const { at } = await readJson(req, publishSchema);
  await publishAnnouncement(actor, await uuidParam(ctx, "id", "Announcement"), at ? new Date(at) : undefined);
  return Response.json({ status: "ok" });
});
