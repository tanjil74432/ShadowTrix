import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError, type ZodType } from "zod";
import { getEnv } from "@/server/config/env";
import { log } from "@/server/logging/logger";
import { assertNotInMaintenance } from "@/server/modules/admin/maintenance.service";
import { assertJsonContentType, assertSameOrigin, guardMultipartBody } from "@/server/security/csrf";
import { AppError, badRequest } from "./errors";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const BASE_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

/**
 * Wraps a route handler with the platform's API rules:
 *  - state-changing methods get the CSRF origin check and must send JSON (opt out with { csrf: false } only for
 *    endpoints that are not cookie-authenticated and idempotent). Order for JSON endpoints: origin, content type, then the
 *    handler's own authentication (a header-only check; no body is read before it);
 *  - { multipart: true } upload endpoints: origin first, then the handler authenticates and authorizes, and only then is the
 *    body's content type enforced (415) when the body is first read, so anonymous callers always get 401 (see guardMultipartBody);
 *  - uniform errors: validation -> 400, AppError -> its status (+ headers such as Retry-After), anything else -> a
 *    generic 500 whose details are logged (redacted) but never returned;
 *  - responses are never cached.
 */
export function apiHandler(handler: Handler, options: { csrf?: boolean; multipart?: boolean } = {}): Handler {
  const csrf = options.csrf ?? true;
  return async (req, ctx) => {
    try {
      if (csrf) {
        assertSameOrigin(req, getEnv().APP_URL);
        if (!options.multipart) assertJsonContentType(req);
        await assertNotInMaintenance(req); // read-only mode pauses public writes (administrators and sign-in stay available)
      }
      const res = await handler(csrf && options.multipart ? guardMultipartBody(req) : req, ctx);
      for (const [k, v] of Object.entries(BASE_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v);
      return res;
    } catch (err) {
      // Next.js signals dynamic rendering, redirects and not-found with thrown errors. Those must propagate untouched.
      unstable_rethrow(err);
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ZodError) {
    return Response.json(
      {
        error: {
          code: "validation_error",
          message: "Invalid input",
          issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
        },
      },
      { status: 400, headers: BASE_HEADERS },
    );
  }
  if (err instanceof AppError) {
    return Response.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status, headers: { ...BASE_HEADERS, ...err.headers } },
    );
  }
  log.error("api.unhandled_error", err);
  return Response.json(
    { error: { code: "internal_error", message: "Something went wrong" } },
    { status: 500, headers: BASE_HEADERS },
  );
}

/** Parses and validates a JSON body. Throws 400 for malformed JSON or a ZodError for invalid shape. */
export async function readJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("invalid_json", "Request body must be valid JSON");
  }
  return schema.parse(raw);
}
