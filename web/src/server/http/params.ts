import { z } from "zod";
import { notFound } from "./errors";

const uuid = z.uuid();

/** The `[id]` route parameter as a UUID. Anything else is a 404 (not a 400), so malformed ids reveal nothing. */
export async function eventId(ctx: { params: Promise<Record<string, string>> }): Promise<string> {
  const parsed = uuid.safeParse((await ctx.params).id);
  if (!parsed.success) throw notFound("Event");
  return parsed.data;
}

/** Any UUID route parameter by name. Malformed values are a 404, like unknown ones. */
export async function uuidParam(ctx: { params: Promise<Record<string, string>> }, name: string, what = "Resource"): Promise<string> {
  const parsed = uuid.safeParse((await ctx.params)[name]);
  if (!parsed.success) throw notFound(what);
  return parsed.data;
}
