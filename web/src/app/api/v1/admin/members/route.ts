import { apiHandler, readJson } from "@/server/http/handler";
import { requireApiPermission } from "@/server/modules/auth/dal";
import { z } from "zod";
import * as org from "@/server/modules/organization/organization.service";
import { memberSchema } from "@/server/modules/organization/organization.schema";

const query = z.object({ q: z.string().trim().max(100).optional(), unitId: z.uuid().optional(), status: z.enum(["ACTIVE", "FORMER"]).optional() });

export const GET = apiHandler(async (req) => {
  const actor = await requireApiPermission("admin:access");
  return Response.json({ items: await org.listMembers(actor, query.parse(Object.fromEntries(new URL(req.url).searchParams))) });
});

/** New members start as unpublished placeholders; nothing is shown publicly until an administrator verifies and publishes them. */
export const POST = apiHandler(async (req) => {
  const actor = await requireApiPermission("admin:access");
  const m = await org.createMember(actor, await readJson(req, memberSchema));
  return Response.json({ id: m.id, slug: m.slug }, { status: 201 });
});

