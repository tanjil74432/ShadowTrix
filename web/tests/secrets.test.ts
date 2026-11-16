import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = resolve(__dirname, "..");
const REPO = resolve(WEB, "..");

const DEV_DEFAULT_FILES = new Set(["docker-compose.yml", "web/.env.example"]);

function tracked(): string[] {
  try {
    return execFileSync("git", ["-C", REPO, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  } catch {
    return []; // not a git checkout (for example a source archive): nothing to check
  }
}

/** Values that must never reach Git or a browser: taken from the real local environment file, when it exists. */
function localSecrets(): { key: string; value: string }[] {
  const envFile = join(WEB, ".env");
  if (!existsSync(envFile)) return [];
  const out: { key: string; value: string }[] = [];
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#\r\n]*)"?/);
    if (!m) continue;
    const [, key, value] = m;
    if (/(SECRET|PASSWORD|TOKEN|KEY)/.test(key) && value.length >= 8) out.push({ key, value });
    if (key === "DATABASE_URL") {
      const pw = value.match(/:\/\/[^:]+:([^@]+)@/)?.[1];
      if (pw && pw.length >= 6) out.push({ key: "DATABASE_URL password", value: pw });
    }
  }
  return out;
}

function walk(dir: string, exts: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p, exts) : exts.test(n) ? [p] : [];
  });
}

describe("secrets never reach Git", () => {
  it(".env files and build output are git-ignored and untracked", () => {
    const files = tracked();
    if (files.length === 0) return;
    expect(files.filter((f) => /(^|\/)\.env($|\.(?!example$))/.test(f))).toEqual([]);
    expect(files.filter((f) => /(^|\/)(\.next|node_modules|\.storage|\.e2e-storage|test-results|playwright-report)\//.test(f))).toEqual([]);
    expect(readFileSync(join(REPO, ".gitignore"), "utf8")).toMatch(/\.env/);
  });

  it("no tracked file contains a private key, a cloud or GitHub token, or a real value from the local .env", () => {
    const files = tracked().filter((f) => !/\.(png|jpg|jpeg|ico|woff2?|pdf|lock)$/.test(f) && !f.endsWith("package-lock.json"));
    if (files.length === 0) return;
    const patterns: [string, RegExp][] = [
      ["private key", /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
      ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/],
      ["GitHub token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/],
      ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
    ];
    const secrets = localSecrets();
    const found: string[] = [];
    for (const f of files) {
      let text: string;
      try {
        text = readFileSync(join(REPO, f), "utf8");
      } catch {
        continue;
      }
      for (const [name, re] of patterns) if (re.test(text)) found.push(`${f}: ${name}`);
      for (const s of secrets) {
        // The local development database password is a documented, throw-away default that docker-compose.yml and
        // .env.example intentionally contain (it only protects a database bound to this machine). Nowhere else.
        if (s.key === "DATABASE_URL password" && DEV_DEFAULT_FILES.has(f)) continue;
        if (text.includes(s.value)) found.push(`${f}: value of ${s.key}`);
      }
    }
    expect(found).toEqual([]);
  });
});

describe("secrets never reach the browser", () => {
  const staticDir = join(WEB, ".next", "static");
  it.skipIf(!existsSync(staticDir))("the built client bundles contain no secret values, connection strings or server-only code markers", () => {
    const files = walk(staticDir, /\.(js|css|html|json|map)$/);
    expect(files.length).toBeGreaterThan(5);
    const secrets = localSecrets();
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const s of secrets) if (text.includes(s.value)) bad.push(`${f}: value of ${s.key}`);
      if (/postgres(ql)?:\/\/[^\s"']+@/.test(text)) bad.push(`${f}: connection string`);
      if (/\$argon2id\$/.test(text)) bad.push(`${f}: password hash`);
      if (/process\.env\.(AUTH_SECRET|DATABASE_URL|SMTP_PASSWORD|CRON_SECRET|S3_SECRET_ACCESS_KEY)/.test(text)) bad.push(`${f}: server environment access`);
      if (/@node-rs\/argon2|nodemailer|pg\.Pool|PrismaClient\(/.test(text)) bad.push(`${f}: server-only library`);
    }
    expect(bad).toEqual([]);
  });
});
