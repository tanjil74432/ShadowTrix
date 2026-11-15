import "server-only";
import { ZodError } from "zod";
import { AppError } from "./errors";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/**
 * Wraps a route handler with uniform error responses:
 * validation errors -> 400, AppError -> its status, anything else -> generic 500.
 * Internal error details are logged server-side and never sent to the client.
 */
export function apiHandler(handler: Handler): Handler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ZodError) {
        return Response.json(
          { error: { code: "validation_error", message: "Invalid input", issues: err.issues.map((i) => ({ path: i.path, message: i.message })) } },
          { status: 400 },
        );
      }
      if (err instanceof AppError) {
        return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status });
      }
      console.error("Unhandled API error:", err);
      return Response.json({ error: { code: "internal_error", message: "Something went wrong" } }, { status: 500 });
    }
  };
}
