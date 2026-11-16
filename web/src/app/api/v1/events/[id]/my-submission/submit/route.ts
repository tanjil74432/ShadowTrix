import { apiHandler } from "@/server/http/handler";
import { eventId } from "@/server/http/params";
import { requireApiUser } from "@/server/modules/auth/dal";
import { submissionSchema } from "@/server/modules/submissions/submissions.schema";
import { submitProject } from "@/server/modules/submissions/submissions.service";

/** Submit (or resubmit) before the deadline; records a version. The body is optional: send it to change the details at the same time. */
export const POST = apiHandler(async (req, ctx) => {
  const actor = await requireApiUser();
  const raw = await req.text();
  let input = null;
  if (raw.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return Response.json({ error: { code: "invalid_json", message: "Request body must be valid JSON" } }, { status: 400 });
    }
    if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) input = submissionSchema.parse(parsed);
  }
  return Response.json(await submitProject(actor, await eventId(ctx), input));
});
