import { apiHandler, readJson } from "@/server/http/handler";
import { requireApiPermission } from "@/server/modules/auth/dal";
import * as org from "@/server/modules/organization/organization.service";
import { organizationSchema } from "@/server/modules/organization/organization.schema";

export const GET = apiHandler(async () => {
  const actor = await requireApiPermission("admin:access");
  return Response.json({ items: await org.listOrganizations(actor) });
});

export const POST = apiHandler(async (req) => {
  const actor = await requireApiPermission("admin:access");
  const created = await org.createOrganization(actor, await readJson(req, organizationSchema));
  return Response.json({ id: created.id, slug: created.slug }, { status: 201 });
});
