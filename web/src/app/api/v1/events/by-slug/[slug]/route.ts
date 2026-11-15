import { z } from "zod";
import { notFound } from "@/server/http/errors";
import { apiHandler } from "@/server/http/handler";
import { getPublicEvent } from "@/server/modules/events/events.service";

const slug = z.string().min(1).max(100).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

/** Public details of a published (or cancelled) event. Drafts and archived events return 404. */
export const GET = apiHandler(async (_req, ctx) => {
  const parsed = slug.safeParse((await ctx.params).slug);
  if (!parsed.success) throw notFound("Event");
  const event = await getPublicEvent(parsed.data);
  if (!event) throw notFound("Event");
  return Response.json(event);
});
