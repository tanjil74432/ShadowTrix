import { describe, expect, it } from "vitest";
import { generateToken, hashToken, hmacId, normalizeEmail } from "@/server/security/tokens";
import { assertJsonContentType, assertSameOrigin } from "@/server/security/csrf";
import { getClientIp } from "@/server/security/client-ip";
import { cookieSettings } from "@/server/modules/auth/session-cookie";
import { redact } from "@/server/logging/logger";
import { safeNextPath } from "@/lib/safe-redirect";
import { escapeHtml } from "@/server/modules/email/mailer";
import { alreadyRegisteredEmail, passwordResetEmail, verificationEmail } from "@/server/modules/email/templates";

const APP = "https://app.example.com";
const req = (method: string, headers: Record<string, string> = {}) => new Request(`${APP}/api/x`, { method, headers });

describe("tokens", () => {
  it("generates 256-bit URL-safe random tokens that never repeat", () => {
    const tokens = new Set(Array.from({ length: 500 }, generateToken));
    expect(tokens.size).toBe(500);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("hashes deterministically with SHA-256 and the hash does not contain the token", () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t.slice(0, 8));
    expect(hashToken(t)).not.toBe(hashToken(generateToken()));
  });

  it("keys identifiers with HMAC: depends on namespace and secret, never exposes the value", () => {
    const secret = "s".repeat(40);
    const a = hmacId("login:email", "user@example.com", secret);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(hmacId("login:email", "user@example.com", secret));
    expect(a).not.toBe(hmacId("forgot:email", "user@example.com", secret));
    expect(a).not.toBe(hmacId("login:email", "user@example.com", "t".repeat(40)));
    expect(a).not.toContain("user");
  });

  it("normalizes email addresses", () => {
    expect(normalizeEmail("  A.B@Example.COM ")).toBe("a.b@example.com");
  });
});

describe("CSRF origin check", () => {
  it("lets safe methods through without headers", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) expect(() => assertSameOrigin(req(m), APP)).not.toThrow();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s: accepts our own Origin", (m) => {
    expect(() => assertSameOrigin(req(m, { origin: APP }), APP)).not.toThrow();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s: rejects foreign, null and look-alike origins", (m) => {
    for (const origin of ["https://evil.example", "null", "https://app.example.com.evil.example", "http://app.example.com", "https://app.example.com:8443"]) {
      expect(() => assertSameOrigin(req(m, { origin }), APP), origin).toThrow(/Cross-site/);
    }
  });

  it("falls back to Sec-Fetch-Site and rejects cross-site, same-site and header-less writes", () => {
    expect(() => assertSameOrigin(req("POST", { "sec-fetch-site": "same-origin" }), APP)).not.toThrow();
    for (const v of ["cross-site", "same-site", "none"]) {
      expect(() => assertSameOrigin(req("POST", { "sec-fetch-site": v }), APP), v).toThrow();
    }
    expect(() => assertSameOrigin(req("POST"), APP)).toThrow();
  });

  it("Origin wins over Sec-Fetch-Site (a spoofed same-origin hint cannot save a foreign Origin)", () => {
    expect(() => assertSameOrigin(req("POST", { origin: "https://evil.example", "sec-fetch-site": "same-origin" }), APP)).toThrow();
  });

  it("requires a JSON content type on body-carrying methods only", () => {
    expect(() => assertJsonContentType(req("POST", { "content-type": "application/json" }))).not.toThrow();
    expect(() => assertJsonContentType(req("POST", { "content-type": "application/json; charset=utf-8" }))).not.toThrow();
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", "application/jsonp", ""]) {
      expect(() => assertJsonContentType(req("POST", type ? { "content-type": type } : {})), type).toThrow(/application\/json/);
    }
    expect(() => assertJsonContentType(req("DELETE"))).not.toThrow();
    expect(() => assertJsonContentType(req("GET"))).not.toThrow();
  });
});

describe("client IP for rate limiting", () => {
  const h = (xff?: string) => new Headers(xff ? { "x-forwarded-for": xff } : {});
  it("ignores forwarding headers unless a trusted proxy is configured (they are attacker-controlled)", () => {
    expect(getClientIp(h("1.2.3.4"), false)).toBeNull();
  });
  it("with a trusted proxy uses the right-most hop appended by that proxy, not a client-forged left-most one", () => {
    expect(getClientIp(h("6.6.6.6, 203.0.113.9"), true)).toBe("203.0.113.9");
    expect(getClientIp(h("203.0.113.9"), true)).toBe("203.0.113.9");
    expect(getClientIp(h(), true)).toBeNull();
  });
});

describe("post-login redirect (open-redirect defence)", () => {
  it.each(["/dashboard", "/admin", "/events?category=hackathon", "/about/team#core-team"])("allows %s", (p) => {
    expect(safeNextPath(p)).toBe(p);
  });
  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "http://localhost:3010/dashboard",
    "dashboard",
    "/\u0000x",
    "/login",
    "/register?next=/",
    "/" + "a".repeat(400),
    "",
  ])("falls back for %j", (p) => {
    expect(safeNextPath(p)).toBe("/dashboard");
  });
  it("falls back for null and undefined", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath(undefined, "/x")).toBe("/x");
  });
});

describe("session cookie policy", () => {
  it("is HttpOnly, SameSite=Lax, path / and uses the __Host- prefix with Secure on https", () => {
    const s = cookieSettings("https://app.example.com", 3600);
    expect(s.name).toBe("__Host-st_session");
    expect(s.options).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 3600 });
  });
  it("drops Secure and the prefix only for plain-http local development", () => {
    const s = cookieSettings("http://localhost:3010", 3600);
    expect(s.name).toBe("st_session");
    expect(s.options.secure).toBe(false);
    expect(s.options.httpOnly).toBe(true);
    expect(s.options.sameSite).toBe("lax");
  });
});

describe("log redaction", () => {
  it("replaces sensitive fields and token-looking strings", () => {
    const token = generateToken();
    const out = redact({
      event: "x",
      password: "hunter2hunter2",
      newPassword: "abc",
      token,
      cookie: "st_session=abc",
      Authorization: "Bearer abc",
      email: "person@example.com",
      passwordHash: "$argon2id$...",
      nested: { sessionToken: token, note: `see ${token} for details`, ok: 1 },
      list: [{ secret: "s" }, `value ${token}`],
    }) as Record<string, unknown>;
    const text = JSON.stringify(out);
    expect(text).not.toContain(token);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("person@example.com");
    expect(text).not.toContain("argon2id");
    expect((out.nested as { ok: number }).ok).toBe(1);
    expect(out.event).toBe("x");
  });
});

describe("email templates", () => {
  it("escape user-supplied names", () => {
    const evil = `<img src=x onerror=alert(1)>"&`;
    const mail = alreadyRegisteredEmail("a@b.co", evil, "https://app.example.com/login", "https://app.example.com/forgot-password");
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
    expect(mail.subject).not.toMatch(/[<>]/);
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
  it("the confirmation email names no person, mentions no password and states the expiry", () => {
    const mail = verificationEmail("a@b.co", "https://app.example.com/verify-email?token=abc", 24);
    expect(mail.text).toContain("https://app.example.com/verify-email?token=abc");
    expect(mail.text).toContain("24 hours");
    expect(mail.text + mail.html).not.toMatch(/password:/i);
  });
  it("link only to the supplied URL and state expiry", () => {
    const mail = passwordResetEmail("a@b.co", "Ada", "https://app.example.com/reset-password?token=abc", 60);
    expect(mail.text).toContain("https://app.example.com/reset-password?token=abc");
    expect(mail.text).toContain("60 minutes");
    const hrefs = [...mail.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.every((u) => u.startsWith("https://app.example.com/"))).toBe(true);
  });
});
