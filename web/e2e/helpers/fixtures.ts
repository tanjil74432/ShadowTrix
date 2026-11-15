import { hash } from "@node-rs/argon2";
import { test as base, expect, type Page, type APIRequestContext } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "../../src/generated/prisma/client";

export const PASSWORD = "correct horse battery staple";
export const NEW_PASSWORD = "a completely different passphrase";
export const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
export const COOKIE = "st_session"; // plain-http e2e server (no __Host- prefix)

let prisma: PrismaClient | undefined;
export const db = () => (prisma ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) }));

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
export const uniqueEmail = (tag = "u") => `e2e-${tag}-${randomUUID().slice(0, 8)}@example.test`;

type RoleName = "PARTICIPANT" | "ORGANIZER" | "JUDGE" | "ADMIN";
export interface TestUser {
  id: string;
  email: string;
  password: string;
  fullName: string;
}

// All test users share one password, so hash it once per worker instead of once per user (Argon2 is deliberately heavy).
let sharedHash: Promise<string> | undefined;
function argon(password: string) {
  if (password !== PASSWORD) return hash(password, { algorithm: 2, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  return (sharedHash ??= hash(password, { algorithm: 2, memoryCost: 65536, timeCost: 3, parallelism: 1 }));
}

export async function createUser(opts: { roles?: RoleName[]; verified?: boolean; status?: "ACTIVE" | "SUSPENDED"; fullName?: string } = {}): Promise<TestUser> {
  const email = uniqueEmail();
  const roles = opts.roles ?? ["PARTICIPANT"];
  const user = await db().user.create({
    data: {
      email,
      fullName: opts.fullName ?? "E2E Person",
      passwordHash: await argon(PASSWORD),
      status: opts.status ?? "ACTIVE",
      emailVerifiedAt: opts.verified === false ? null : new Date(),
      roles: { create: [...new Set(["PARTICIPANT", ...roles])].map((role) => ({ role: role as RoleName })) },
    },
  });
  return { id: user.id, email, password: PASSWORD, fullName: user.fullName };
}

/** Writes a session row directly (to test expiry and revocation) and returns the raw cookie value. */
export async function createRawSession(userId: string, opts: { expiresAt?: Date; lastSeenAt?: Date; revokedAt?: Date } = {}) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await db().session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      createdAt: new Date(now - 60_000),
      lastSeenAt: opts.lastSeenAt ?? new Date(now),
      expiresAt: opts.expiresAt ?? new Date(now + 3_600_000),
      revokedAt: opts.revokedAt ?? null,
    },
  });
  return token;
}

export interface Mail {
  subject: string;
  text: string;
  link: (path: "verify-email" | "reset-password") => string;
}

/** Polls Mailpit until an email for `to` whose subject matches arrives. These are the real emails the app sent over SMTP. */
export async function waitForMail(to: string, subject: RegExp, timeoutMs = 15_000): Promise<Mail> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    const body = (await res.json()) as { messages?: { ID: string; Subject: string }[] };
    const hit = body.messages?.find((m) => subject.test(m.Subject));
    if (hit) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json()) as { Text: string; Subject: string };
      return {
        subject: full.Subject,
        text: full.Text,
        link: (path) => {
          const m = full.Text.match(new RegExp(`https?://[^\\s]+/${path}\\?token=[A-Za-z0-9_-]+`));
          if (!m) throw new Error(`no ${path} link in email`);
          return m[0];
        },
      };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email to ${to} matching ${subject}`);
}

export async function mailCount(to: string): Promise<number> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
  return ((await res.json()) as { messages?: unknown[] }).messages?.length ?? 0;
}

/** Logs in through the real login form. */
export async function uiLogin(page: Page, user: { email: string; password: string }, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByLabel(/^Email address/).fill(user.email);
  await page.getByLabel(/^Password/).fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
}

/** The origin a browser on the test server sends. API tests pass it explicitly (APIRequestContext adds no Origin). */
export const ORIGIN = "http://localhost:3011";
export const JSON_HEADERS = { Origin: ORIGIN, "Content-Type": "application/json" };

export function post(request: APIRequestContext, url: string, data: unknown, headers: Record<string, string> = JSON_HEADERS) {
  return request.post(url, { data, headers });
}

/** Test fixture that removes every user a test created (cascades to sessions, tokens, roles). */
export const test = base.extend<{ users: { create: typeof createUser; track: (email: string) => void; list: TestUser[] } }>({
  users: async ({}, use) => {
    const list: TestUser[] = [];
    const extraEmails: string[] = [];
    await use({
      list,
      create: async (o) => {
        const u = await createUser(o);
        list.push(u);
        return u;
      },
      track: (email) => void extraEmails.push(email.toLowerCase()),
    });
    const emails = [...list.map((u) => u.email), ...extraEmails];
    const where = { OR: [{ id: { in: list.map((u) => u.id) } }, { email: { in: emails } }] };
    // Remove audit rows first: once the user is gone their actor reference is nulled and they could no longer be found.
    const ids = (await db().user.findMany({ where, select: { id: true } })).map((u) => u.id);
    const eventIds = (await db().event.findMany({ where: { createdById: { in: ids } }, select: { id: true } })).map((e) => e.id);
    await db().auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: [...ids, ...eventIds] } }] } });
    await db().event.deleteMany({ where: { id: { in: eventIds } } });
    await db().user.deleteMany({ where });
  },
});

export { expect };
