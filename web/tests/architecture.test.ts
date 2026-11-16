import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Architecture rules, enforced as tests so they cannot rot. ShadowTrix is ONE Next.js application with a strict logical
 * separation (see docs/architecture/code-organization.md):
 *
 *   frontend : src/app (pages), src/components, src/lib (browser-safe helpers), src/types
 *   backend  : src/app/api (route handlers), src/server (modules, security, http, config, logging)
 *   database : prisma/ (schema, migrations, seed, CLI scripts), src/generated (Prisma client), src/server/db
 */
const SRC = join(__dirname, "..", "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (full.includes(`${sep}generated`)) return [];
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}
const files = walk(SRC).map((f) => ({ path: relative(SRC, f).split(sep).join("/"), text: readFileSync(f, "utf8") }));
const imports = (text: string) => [...text.matchAll(/(?:import|export)[^"']*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']/g)].map((m) => m[1] ?? m[2]);
const isClient = (text: string) => /^\s*["']use client["']/.test(text);

describe("frontend / backend / database separation", () => {
  it("scans a meaningful number of files (the test itself is not vacuous)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((f) => isClient(f.text)).length).toBeGreaterThan(15);
  });

  it("no browser (\"use client\") file imports anything from the backend or the database layer", () => {
    const bad = files.filter((f) => isClient(f.text)).flatMap((f) => imports(f.text).filter((i) => /^@\/(server|generated)\b|@prisma|^node:|argon2/.test(i)).map((i) => `${f.path} -> ${i}`));
    expect(bad).toEqual([]);
  });

  it("browser-safe folders (components, lib, types, content) never import backend or database code", () => {
    // components may include server components that call the data-access layer (dal, services); those go through src/server/modules only.
    const bad = files
      .filter((f) => /^(lib|types|content)\//.test(f.path))
      .flatMap((f) => imports(f.text).filter((i) => /^@\/(server|generated)\b|@prisma|^node:/.test(i)).map((i) => `${f.path} -> ${i}`));
    expect(bad).toEqual([]);
  });

  it("only the service layer (src/server) touches the database client or Prisma", () => {
    const bad = files
      .filter((f) => !f.path.startsWith("server/"))
      .flatMap((f) => imports(f.text).filter((i) => /^@\/server\/db\b|^@\/generated\b|@prisma\/(client|adapter)/.test(i)).map((i) => `${f.path} -> ${i}`));
    expect(bad).toEqual([]);
  });

  it("everything that can reach a secret, the database or the environment is marked server-only", () => {
    const sensitive = /@\/server\/db\b|@\/generated\b|@\/server\/config\/env|node:crypto|next\/headers|@node-rs\/argon2|nodemailer/;
    // Pure, dependency-free modules (no secrets, no I/O) may be shared by tests and scripts; each is listed on purpose.
    const allowedWithoutMarker = new Set([
      "server/modules/maintenance/cleanup.core.ts", // type-only Prisma import; shared with the CLI script
      "server/security/secret-box.ts", // takes its key as a parameter; no environment access
      "server/security/totp.ts", // pure RFC 6238 functions
    ]);
    const bad = files
      .filter((f) => f.path.startsWith("server/") && !allowedWithoutMarker.has(f.path))
      .filter((f) => imports(f.text).some((i) => sensitive.test(i)) && !/import\s*["']server-only["']/.test(f.text))
      .map((f) => f.path);
    expect(bad).toEqual([]);
  });

  it("only the storage layer touches the file system, so uploaded files can only be reached through it", () => {
    const bad = files.filter((f) => !f.path.startsWith("server/storage/")).filter((f) => imports(f.text).some((i) => /^(node:)?fs(\/promises)?$/.test(i))).map((f) => f.path);
    expect(bad).toEqual([]);
  });

  it("storage keys, uploads and downloads never come from user-controlled paths: handlers use the storage-backed services only", () => {
    const bad = files.filter((f) => f.path.startsWith("app/")).filter((f) => /@\/server\/storage\/(local-storage|index)/.test(f.text)).map((f) => f.path);
    expect(bad).toEqual([]);
  });

  it("route handlers contain no database code: they validate, authorize and call a module", () => {
    const bad = files.filter((f) => f.path.startsWith("app/api/")).filter((f) => /getDb\(|\.\$transaction|prisma\./i.test(f.text)).map((f) => f.path);
    expect(bad).toEqual([]);
  });

  it("every state-changing route handler goes through the shared apiHandler (CSRF, error shape, no-store)", () => {
    const routes = files.filter((f) => /^app\/api\/.+\/route\.ts$/.test(f.path));
    expect(routes.length).toBeGreaterThan(20);
    const bad = routes
      .filter((f) => /export const (POST|PUT|PATCH|DELETE)\b|export async function (POST|PUT|PATCH|DELETE)\b/.test(f.text))
      .filter((f) => !/export const (POST|PUT|PATCH|DELETE) = apiHandler\(/.test(f.text))
      .map((f) => f.path);
    expect(bad).toEqual([]);
  });

  it("the pure rule modules (permissions, lifecycle, schemas) have no framework, database or I/O imports", () => {
    const pure = ["server/modules/judging/scoring.ts", "server/storage/file-validation.ts", "server/storage/storage.ts", "server/modules/authz/permissions.ts", "server/modules/events/event-lifecycle.ts", "server/modules/events/event.schema.ts", "server/modules/auth/auth.schema.ts", "server/security/totp.ts"];
    const bad = files.filter((f) => pure.includes(f.path)).flatMap((f) => imports(f.text).filter((i) => /^(next|react|@\/generated|@\/server\/db)|^node:fs|^@prisma/.test(i)).map((i) => `${f.path} -> ${i}`));
    expect(bad).toEqual([]);
  });
});
