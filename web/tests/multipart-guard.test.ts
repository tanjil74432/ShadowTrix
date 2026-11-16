import { describe, expect, it } from "vitest";
import { apiHandler } from "@/server/http/handler";
import { assertMultipart, guardMultipartBody } from "@/server/security/csrf";

const URL_ = "http://localhost:3010/api/v1/x";
const req = (headers: Record<string, string>, body: BodyInit | null = "payload") => new Request(URL_, { method: "POST", headers, body });
const status = async (fn: () => unknown) => { try { await fn(); return 200; } catch (e) { return (e as { status?: number }).status ?? 500; } };

describe("guardMultipartBody: the multipart contract is enforced when the body is first read", () => {
  it("every body reader refuses a non-multipart request with 415 before reading anything", async () => {
    for (const reader of ["formData", "arrayBuffer", "blob", "text", "json"] as const) {
      const guarded = guardMultipartBody(req({ "Content-Type": "application/json", Origin: "http://localhost:3010" }, '{"a":1}'));
      expect(await status(() => guarded[reader]()), reader).toBe(415);
      expect(guarded.bodyUsed, `${reader} must not consume the body`).toBe(false);
    }
    expect(await status(() => guardMultipartBody(req({ "Content-Type": "text/plain" })).body)).toBe(415); // the raw stream too
    expect(await status(() => guardMultipartBody(req({ "Content-Type": "multipart/form-data" })).formData())).toBe(415); // no boundary
  });

  it("a real multipart request passes through untouched, and headers and other properties stay readable on any request", async () => {
    const fd = new FormData();
    fd.set("file", new File(["hello"], "a.txt", { type: "text/plain" }));
    const real = new Request(URL_, { method: "POST", body: fd });
    const guarded = guardMultipartBody(real);
    expect(guarded.method).toBe("POST");
    expect(guarded.url).toBe(URL_);
    expect(guarded.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    const form = await guarded.formData();
    expect((form.get("file") as File).name).toBe("a.txt");
    // headers and metadata of a NON-multipart request are readable too (authentication happens before any body access)
    const other = guardMultipartBody(req({ "Content-Type": "application/json", Authorization: "x" }));
    expect(other.headers.get("authorization")).toBe("x");
    expect(other.method).toBe("POST");
  });

  it("assertMultipart itself is strict about the declared type", () => {
    expect(() => assertMultipart(req({ "Content-Type": "multipart/form-data; boundary=x" }))).not.toThrow();
    for (const bad of ["application/json", "text/plain", "multipart/form-data", "multipart/mixed; boundary=x", ""]) {
      expect(() => assertMultipart(req(bad ? { "Content-Type": bad } : {})), bad || "(none)").toThrow(expect.objectContaining({ status: 415 }));
    }
  });
});

describe("apiHandler({ multipart: true }) ordering", () => {
  const ORIGIN = "http://localhost:3010";
  const ctx = { params: Promise.resolve({}) };
  const unauthenticated = async () => { const { unauthorized } = await import("@/server/http/errors"); throw unauthorized(); };

  it("origin is checked first (403), then the handler's authentication (401) BEFORE the content type (415)", async () => {
    const h = apiHandler(async (r) => { await unauthenticated(); await r.formData(); return Response.json({}); }, { multipart: true });
    expect((await h(req({ "Content-Type": "application/json" }), ctx)).status).toBe(403); // no Origin
    expect((await h(req({ "Content-Type": "application/json", Origin: ORIGIN }), ctx)).status).toBe(401); // anonymous + wrong type
    expect((await h(req({ "Content-Type": "text/plain", Origin: ORIGIN }), ctx)).status).toBe(401);
  });

  it("an authenticated handler that reads the body gets 415 for the wrong type, even if it never calls assertMultipart itself", async () => {
    const h = apiHandler(async (r) => { await r.formData(); return Response.json({ ok: true }); }, { multipart: true });
    expect((await h(req({ "Content-Type": "application/json", Origin: ORIGIN }), ctx)).status).toBe(415);
  });

  it("JSON endpoints keep their documented order: origin, content type, then the handler", async () => {
    const h = apiHandler(async () => { await unauthenticated(); return Response.json({}); });
    expect((await h(req({ "Content-Type": "text/plain", Origin: ORIGIN }), ctx)).status).toBe(415);
    expect((await h(req({ "Content-Type": "application/json", Origin: ORIGIN }, "{}"), ctx)).status).toBe(401);
  });
});
