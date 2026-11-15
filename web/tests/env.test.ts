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
