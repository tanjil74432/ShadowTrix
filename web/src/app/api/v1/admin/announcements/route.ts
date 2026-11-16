import { apiHandler, readJson } from "@/server/http/handler";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { announcementListSchema, announcementSchema, createAnnouncement, listAnnouncementsAdmin } from "@/server/modules/admin/announcements.service";

export const GET = apiHandler(async (req) => {
  const actor = await requireApiPermission("admin:access");
  return Response.json(await listAnnouncementsAdmin(actor, announcementListSchema.parse(Object.fromEntries(new URL(req.url).searchParams))));
});

/** Creates a DRAFT; nothing is visible until it is published. */
export const POST = apiHandler(async (req) => {
  const actor = await requireApiPermission("admin:access");
  const a = await createAnnouncement(actor, await readJson(req, announcementSchema));
  return Response.json({ id: a.id }, { status: 201 });
});
