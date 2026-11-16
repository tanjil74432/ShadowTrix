import { apiHandler } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { unpublishAnnouncement } from "@/server/modules/admin/announcements.service";

export const POST = apiHandler(async (_req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  await unpublishAnnouncement(actor, await uuidParam(ctx, "id", "Announcement"));
  return Response.json({ status: "ok" });
});
