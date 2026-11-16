import { apiHandler, readJson } from "@/server/http/handler";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { z } from "zod";
import { setSignupsEnabled } from "@/server/modules/admin/admin-management.service";
import { getPlatformConfig } from "@/server/modules/admin/platform-config.service";

/** Read-only platform configuration (secrets are never included, only whether they are configured). */
export const GET = apiHandler(async () => {
  const actor = await requireApiPermission("admin:access");
  return Response.json(await getPlatformConfig(actor));
});

/** The one runtime setting: pause or resume new account registration. */
export const PATCH = apiHandler(async (req) => {
  const actor = await requireApiPermission("admin:access");
  const { signupsEnabled } = await readJson(req, z.object({ signupsEnabled: z.boolean() }));
  await setSignupsEnabled(actor, signupsEnabled);
  return Response.json({ signupsEnabled });
});

