/** Errors that are safe to show to API clients. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Extra response headers, e.g. Retry-After on 429. */
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found`);
export const unauthorized = () => new AppError(401, "unauthorized", "Authentication required");
export const forbidden = () => new AppError(403, "forbidden", "You do not have access to this resource");
export const conflict = (message: string) => new AppError(409, "conflict", message);
export const badRequest = (code: string, message: string) => new AppError(400, code, message);
