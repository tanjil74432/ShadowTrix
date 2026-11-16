import { apiHandler, readJson } from "@/server/http/handler";
import { uuidParam } from "@/server/http/params";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { announcementSchema, deleteAnnouncement, getAnnouncementAdmin, updateAnnouncement } from "@/server/modules/admin/announcements.service";

export const GET = apiHandler(async (_req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  return Response.json(await getAnnouncementAdmin(actor, await uuidParam(ctx, "id", "Announcement")));
});

export const PUT = apiHandler(async (req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  await updateAnnouncement(actor, await uuidParam(ctx, "id", "Announcement"), await readJson(req, announcementSchema));
  return Response.json({ status: "ok" });
});

/** Drafts only; anything that was visible must be unpublished first. */
export const DELETE = apiHandler(async (_req, ctx) => {
  const actor = await requireApiPermission("admin:access");
  await deleteAnnouncement(actor, await uuidParam(ctx, "id", "Announcement"));
  return Response.json({ status: "ok" });
});
