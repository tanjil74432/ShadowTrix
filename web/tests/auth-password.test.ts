import { describe, expect, it } from "vitest";
import { ARGON2_PARAMS, burnPasswordVerification, hashPassword, needsRehash, verifyPassword } from "@/server/modules/auth/password";
import { PASSWORD_HINT, PASSWORD_MAX, PASSWORD_MIN } from "@/lib/password-policy";
import { completeRegistrationSchema, loginSchema, passwordIssues, registerSchema, resetPasswordSchema } from "@/server/modules/auth/auth.schema";

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
    // Compare against a real verification measured on this same machine, so the check holds on fast and slow hardware.
    const real = await hashPassword("a real stored password");
    await verifyPassword(real, "warm-up");
    const t0 = performance.now();
    await verifyPassword(real, "wrong guess");
    const realVerify = performance.now() - t0;

    await burnPasswordVerification("warm-up"); // the first call also creates the dummy hash
    const t1 = performance.now();
    await burnPasswordVerification("whatever");
    const burn = performance.now() - t1;
    expect(burn).toBeGreaterThan(realVerify * 0.4); // same order of cost as a genuine verification
    expect(burn).toBeLessThan(realVerify * 5);
  });
});

describe("password policy", () => {
  it.each([
    ["short", "Use at least 12 characters."],
    ["administrator", "That password is too common. Try a longer passphrase."],
    ["aaaaaaaaaaaa", "Do not repeat a single character."],
  ])("rejects %s", (pw, message) => {
    expect(passwordIssues(pw)).toBe(message);
  });

  it("enforces the approved minimum of exactly 12 characters", () => {
    expect(PASSWORD_MIN).toBe(12);
    const eleven = "pq7-lmn-x2z"; // 11 characters, not common, not repeated
    const twelve = "pq7-lmn-x2zk"; // 12 characters
    expect(eleven).toHaveLength(11);
    expect(twelve).toHaveLength(12);
    expect(passwordIssues(eleven)).toBe("Use at least 12 characters.");
    expect(passwordIssues(twelve)).toBeNull();
    // the previous minimum (10) is no longer enough
    expect(passwordIssues("abcdefghij")).toBe("Use at least 12 characters.");
  });

  it("counts characters, not bytes: 12 multi-byte characters pass, 11 do not", () => {
    const eleven = "九州山川海空風雨雪月星";
    const twelve = `${eleven}日`;
    expect(eleven).toHaveLength(11);
    expect(twelve).toHaveLength(12);
    expect(passwordIssues(eleven)).toBe("Use at least 12 characters.");
    expect(passwordIssues(twelve)).toBeNull();
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
  it("normalizes email (trim, lowercase) and trims the name at the completion step", () => {
    expect(registerSchema.parse({ email: "  Test.User@Example.COM " }).email).toBe("test.user@example.com");
    const r = completeRegistrationSchema.parse({ token: "t".repeat(43), fullName: "  Ada Lovelace  ", password: "a long passphrase here" });
    expect(r.fullName).toBe("Ada Lovelace");
  });

  it("rejects bad emails, short names, markup in names and weak passwords with field-level messages", () => {
    expect(registerSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    const token = "t".repeat(43);
    const bad = completeRegistrationSchema.safeParse({ token, fullName: "A", password: "short" });
    expect(bad.success).toBe(false);
    const paths = bad.error!.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["fullName", "password"]));
    expect(completeRegistrationSchema.safeParse({ token, fullName: "<script>x</script>", password: "a long passphrase here" }).success).toBe(false);
  });

  it("never discloses password rules at login, only that a value is required", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });

  it("completing registration enforces the 12-character minimum: 11 rejected on the password field, 12 accepted", () => {
    const base = { token: "t".repeat(43), fullName: "Ada Lovelace" };
    const eleven = completeRegistrationSchema.safeParse({ ...base, password: "pq7-lmn-x2z" });
    expect(eleven.success).toBe(false);
    expect(eleven.error!.issues).toEqual([expect.objectContaining({ path: ["password"], message: "Use at least 12 characters." })]);
    expect(completeRegistrationSchema.safeParse({ ...base, password: "pq7-lmn-x2zk" }).success).toBe(true);
  });

  it("password reset enforces the same minimum: 11 rejected, 12 accepted", () => {
    const token = "t".repeat(43);
    const eleven = resetPasswordSchema.safeParse({ token, password: "pq7-lmn-x2z" });
    expect(eleven.success).toBe(false);
    expect(eleven.error!.issues).toEqual([expect.objectContaining({ path: ["password"], message: "Use at least 12 characters." })]);
    expect(resetPasswordSchema.safeParse({ token, password: "pq7-lmn-x2zk" }).success).toBe(true);
  });

  it("the browser hint and the server limit come from one constant", () => {
    expect(PASSWORD_HINT).toContain(`${PASSWORD_MIN} characters`);
    expect(PASSWORD_MIN).toBe(12);
    expect(PASSWORD_MAX).toBe(128);
  });

  it("applies the password policy to resets and bounds the token length", () => {
    const token = "t".repeat(43);
    expect(resetPasswordSchema.safeParse({ token, password: "short" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: "x", password: "a long passphrase here" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: "t".repeat(500), password: "a long passphrase here" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token, password: "a long passphrase here" }).success).toBe(true);
  });
});
