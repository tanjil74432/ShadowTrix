import { z } from "zod";
import { apiHandler } from "@/server/http/handler";
import { listUsers } from "@/server/modules/admin/admin-users.service";
import { requireApiPermission } from "@/server/modules/auth/dal";

const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
});

/** Administrators only. 401 when anonymous, 403 for any other role. */
export const GET = apiHandler(async (req) => {
  const actor = await requireApiPermission("users:read");
  const params = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await listUsers(actor, params));
});
