import { apiHandler } from "@/server/http/handler";
import { requireApiUser } from "@/server/modules/auth/dal";
import { listMyCertificates } from "@/server/modules/certificates/certificates.service";

export const GET = apiHandler(async () => {
  const user = await requireApiUser();
  return Response.json({ items: await listMyCertificates(user.id) });
});
