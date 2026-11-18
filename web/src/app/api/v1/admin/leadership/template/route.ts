import { z } from "zod";
import { apiHandler, readJson } from "@/server/http/handler";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { getLeadershipTemplate, resetLeadershipTemplate, saveLeadershipTemplate } from "@/server/modules/organization/leadership-template.service";

/** The Universal Matrix Leadership Template. Administrators only (401 anonymous, 403 everybody else). */
export const GET = apiHandler(async () => {
  await requireApiPermission("admin:access");
  return Response.json({ template: await getLeadershipTemplate() });
});

export const PUT = apiHandler(async (req) => {
  const actor = await requireApiPermission("admin:access");
  const body = await readJson(req, z.record(z.string(), z.unknown()));
  return Response.json({ template: await saveLeadershipTemplate(actor, body) });
});

export const DELETE = apiHandler(async () => {
  const actor = await requireApiPermission("admin:access");
  return Response.json({ template: await resetLeadershipTemplate(actor) });
});
