import { apiHandler } from "@/server/http/handler";
import { requireApiPermission } from "@/server/modules/auth/dal";
import * as org from "@/server/modules/organization/organization.service";

/** Units, designations and terms. */
export const GET = apiHandler(async () => {
  const actor = await requireApiPermission("admin:access");
  return Response.json(await org.listLeadershipReference(actor));
});
