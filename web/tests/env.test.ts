import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/config/env";

const base = { DATABASE_URL: "postgresql://u:p@localhost:5433/db" };

describe("parseEnv", () => {
  it("applies defaults", () => {
    const env = parseEnv(base);
    expect(env.SMTP_PORT).toBe(1025);
    expect(env.STORAGE_DRIVER).toBe("local");
    expect(env.SMTP_SECURE).toBe(false);
  });

  it("requires DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("requires S3 settings when the s3 driver is chosen", () => {
    expect(() => parseEnv({ ...base, STORAGE_DRIVER: "s3" })).toThrow(/S3_BUCKET/);
  });

  it("requires AUTH_SECRET in production", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production" })).toThrow(/AUTH_SECRET/);
    expect(() => parseEnv({ ...base, NODE_ENV: "production", AUTH_SECRET: "x".repeat(32) })).not.toThrow();
  });

  it("rejects placeholder secrets and non-https public URLs in production, but allows plain http on localhost", () => {
    const prod = { ...base, NODE_ENV: "production" };
    expect(() => parseEnv({ ...prod, AUTH_SECRET: "dev-only-not-a-secret-change-me-0123456789abcdef" })).toThrow(/placeholder/);
    expect(() => parseEnv({ ...prod, AUTH_SECRET: "x".repeat(32), APP_URL: "http://shadowtrix.example.org" })).toThrow(/https/);
    expect(() => parseEnv({ ...prod, AUTH_SECRET: "x".repeat(32), APP_URL: "https://shadowtrix.example.org" })).not.toThrow();
    expect(() => parseEnv({ ...prod, AUTH_SECRET: "x".repeat(32), APP_URL: "http://localhost:3011" })).not.toThrow();
  });

  it("requires AUTH_SECRET to be at least 32 characters when set", () => {
    expect(() => parseEnv({ ...base, AUTH_SECRET: "too-short" })).toThrow(/AUTH_SECRET/);
  });

  it("defaults auth settings safely: proxy headers untrusted, 30-day absolute and 7-day idle sessions", () => {
    const env = parseEnv(base);
    expect(env.TRUST_PROXY).toBe(false);
    expect(env.SESSION_ABSOLUTE_TTL_DAYS).toBe(30);
    expect(env.SESSION_IDLE_TTL_DAYS).toBe(7);
    expect(() => parseEnv({ ...base, SESSION_IDLE_TTL_DAYS: "0" })).toThrow();
    expect(() => parseEnv({ ...base, SESSION_ABSOLUTE_TTL_DAYS: "365" })).toThrow();
  });

  it("does not leak values in error messages", () => {
    let message = "";
    try {
      parseEnv({ ...base, AUTH_SECRET: "short-secret-value" });
    } catch (e) {
      message = String(e);
    }
    expect(message).toContain("AUTH_SECRET");
    expect(message).not.toContain("short-secret-value");
  });
});
