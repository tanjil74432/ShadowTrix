import { apiHandler } from "@/server/http/handler";
import { requireApiUser } from "@/server/modules/auth/dal";
import { availableTemplates } from "@/server/modules/banner/template-access";

/** The banner templates the signed-in person may use. 401 when anonymous. Matrix is listed for administrators only. */
export const GET = apiHandler(async () => {
  const actor = await requireApiUser();
  return Response.json({ templates: availableTemplates(actor) });
});
