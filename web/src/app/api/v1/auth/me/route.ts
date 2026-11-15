import { apiHandler } from "@/server/http/handler";
import { requireApiUser } from "@/server/modules/auth/dal";
import { can, PERMISSIONS } from "@/server/modules/authz/permissions";

/** The signed-in user, their roles and effective permissions (computed on the server from database roles). */
export const GET = apiHandler(async () => {
  const user = await requireApiUser();
  return Response.json({
    user: { id: user.id, email: user.email, fullName: user.fullName, roles: user.roles },
    permissions: PERMISSIONS.filter((p) => can(user, p)),
  });
});
