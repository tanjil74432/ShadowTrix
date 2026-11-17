import { apiHandler } from "@/server/http/handler";
import { requireApiUser } from "@/server/modules/auth/dal";
import { assertTemplateAllowed } from "@/server/modules/banner/template-access";

/**
 * Checked by the editor before it exports a banner: `GET /api/v1/banner/template-access?template=matrix`. 200 when the signed-in person may use
 * that template, 401 when anonymous, 403 for Matrix without the administrator permission, 400 for an unknown template name.
 */
export const GET = apiHandler(async (req) => {
  const actor = await requireApiUser();
  const template = assertTemplateAllowed(actor, new URL(req.url).searchParams.get("template"));
  return Response.json({ template, allowed: true });
});
