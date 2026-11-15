import { describe, expect, it } from "vitest";
import { ARGON2_PARAMS, burnPasswordVerification, hashPassword, needsRehash, verifyPassword } from "@/server/modules/auth/password";
import { loginSchema, passwordIssues, registerSchema, resetPasswordSchema } from "@/server/modules/auth/auth.schema";

describe("password hashing (Argon2id)", () => {
  it("produces an Argon2id hash with the documented parameters, never the plaintext", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(hash).not.toContain("correct horse");
    expect(ARGON2_PARAMS).toMatchObject({ memoryCost: 65536, timeCost: 3, parallelism: 1 });
  });

  it("salts every hash (same password, different hashes) and verifies correctly", async () => {
    const [a, b] = await Promise.all([hashPassword("same password 123"), hashPassword("same password 123")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, "same password 123")).toBe(true);
    expect(await verifyPassword(a, "Same password 123")).toBe(false);
    expect(await verifyPassword(a, "")).toBe(false);
  });

  it("treats a malformed stored hash as a failed login instead of throwing", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
    expect(await verifyPassword("", "anything")).toBe(false);
  });

  it("flags hashes made with weaker parameters (or another algorithm) for re-hashing", async () => {
    expect(needsRehash(await hashPassword("a long enough password"))).toBe(false);
    expect(needsRehash("$argon2id$v=19$m=8192,t=1,p=1$c29tZXNhbHQ$aGFzaA")).toBe(true);
    expect(needsRehash("$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$aGFzaA")).toBe(true);
    expect(needsRehash("$2b$12$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz0123")).toBe(true);
    expect(needsRehash("plaintext")).toBe(true);
  });

  it("burnPasswordVerification does real work without throwing (timing equalization for unknown users)", async () => {
    const start = performance.now();
    await burnPasswordVerification("whatever");
    // first call also creates the dummy hash; later calls still verify (>= tens of ms with 64 MiB Argon2)
    const second = performance.now();
    await burnPasswordVerification("whatever");
    expect(performance.now() - second).toBeGreaterThan(20);
    expect(second - start).toBeGreaterThan(20);
  });
});

describe("password policy", () => {
  it.each([
    ["short", "Use at least 10 characters."],
    ["password123", "That password is too common. Try a longer passphrase."],
    ["aaaaaaaaaaaa", "Do not repeat a single character."],
  ])("rejects %s", (pw, message) => {
    expect(passwordIssues(pw)).toBe(message);
  });

  it("rejects passwords containing the email name and over-long passwords", () => {
    expect(passwordIssues("my-tanjil74432-secret", "tanjil74432@example.com")).toMatch(/email/);
    expect(passwordIssues("x".repeat(129))).toMatch(/at most 128/);
  });

  it("accepts passphrases without composition rules, including spaces and unicode", () => {
    expect(passwordIssues("correct horse battery staple")).toBeNull();
    expect(passwordIssues("pässwörd mit ümlauten 九州")).toBeNull();
    expect(passwordIssues("ab".repeat(64))).toBeNull(); // exactly 128 characters is allowed
    expect(passwordIssues("ab".repeat(64) + "c")).toMatch(/at most 128/);
  });
});

describe("auth input schemas", () => {
  it("normalizes email (trim, lowercase) and trims the name", () => {
    const r = registerSchema.parse({ email: "  Test.User@Example.COM ", fullName: "  Ada Lovelace  ", password: "a long passphrase here" });
    expect(r.email).toBe("test.user@example.com");
    expect(r.fullName).toBe("Ada Lovelace");
  });

  it("rejects bad emails, short names, markup in names and weak passwords with field-level messages", () => {
    const bad = registerSchema.safeParse({ email: "not-an-email", fullName: "A", password: "short" });
    expect(bad.success).toBe(false);
    const paths = bad.error!.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["email", "fullName", "password"]));
    expect(registerSchema.safeParse({ email: "a@b.co", fullName: "<script>x</script>", password: "a long passphrase here" }).success).toBe(false);
  });

  it("never discloses password rules at login, only that a value is required", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });

  it("applies the password policy to resets and bounds the token length", () => {
    const token = "t".repeat(43);
    expect(resetPasswordSchema.safeParse({ token, password: "short" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: "x", password: "a long passphrase here" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: "t".repeat(500), password: "a long passphrase here" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token, password: "a long passphrase here" }).success).toBe(true);
  });
});
