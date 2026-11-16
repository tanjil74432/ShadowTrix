import { randomUUID } from "node:crypto";
import { COOKIE, JSON_HEADERS, ORIGIN, createRawSession, db, expect, test } from "./helpers/fixtures";

/**
 * Order of checks on the two multipart upload endpoints (profile photo and project files):
 *   1. Origin / CSRF            -> 403
 *   2. Authentication           -> 401   (an anonymous caller learns nothing about the expected body format)
 *   3. Authorization            -> 403   (a signed-in caller without the permission is refused before the body is looked at)
 *   4. Content type            -> 415   (only callers who passed 1 to 3)
 *   5. Declared size, body parsing, field and file validation -> 411 / 413 / 400
 * JSON endpoints keep their documented order (origin, content type, then authentication): see docs/api/conventions.md.
 */
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050001a5f645400000000049454e44ae426082", "hex");
const cookie = async (user: { id: string }) => ({ Cookie: `${COOKIE}=${await createRawSession(user.id)}` });

type Target = { name: string; url: string; allowed: () => Promise<Record<string, string>>; denied: () => Promise<Record<string, string>>; good: { name: string; mimeType: string; buffer: Buffer } };

test.describe("upload endpoints: authentication comes before content-type and body validation", () => {
  test("profile photo (administrators) and project files (confirmed participants)", async ({ request, users }) => {
    test.setTimeout(120_000);
    const admin = await users.create({ roles: ["ADMIN"], fullName: "Upload Admin" });
    const outsider = await users.create({ fullName: "Plain User" });
    const organizer = await users.create({ roles: ["ORGANIZER"] });
    const participant = await users.create({ fullName: "Registered Participant" });
    const now = Date.now();
    const event = await db().event.create({
      data: {
        slug: `e2e-up-${randomUUID().slice(0, 8)}`, title: "E2E upload order", category: "HACKATHON", summary: "Upload order test.", description: "Upload order test.", status: "PUBLISHED", createdById: organizer.id,
        organizers: { create: { userId: organizer.id, isLead: true } }, registrationOpensAt: new Date(now - 86_400_000), registrationClosesAt: new Date(now + 5 * 86_400_000),
        startsAt: new Date(now - 3_600_000), endsAt: new Date(now + 8 * 86_400_000), submissionDeadline: new Date(now + 7 * 86_400_000), capacity: 10,
      },
    });
    await db().registration.create({ data: { eventId: event.id, userId: participant.id, status: "CONFIRMED" } });
    const member = await db().orgMember.create({ data: { slug: `e2e-up-${randomUUID().slice(0, 8)}`, fullName: "E2E Upload Member" } });

    const targets: Target[] = [
      { name: "member photo", url: `/api/v1/admin/members/${member.id}/photo`, allowed: () => cookie(admin), denied: () => cookie(outsider), good: { name: "me.png", mimeType: "image/png", buffer: PNG } },
      { name: "project file", url: `/api/v1/events/${event.id}/my-submission/files`, allowed: () => cookie(participant), denied: () => cookie(outsider), good: { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") } },
    ];
    const withOrigin = { Origin: ORIGIN };
    const boundaryType = "multipart/form-data; boundary=----shadowtrixtest";
    try {
      for (const t of targets) {
        const at = (label: string) => `${t.name}: ${label}`;
        const status = async (headers: Record<string, string>, extra: Record<string, unknown>) => (await request.post(t.url, { headers, ...extra })).status();

        // 1. origin / CSRF first
        expect(await status({}, { multipart: { file: t.good } }), at("no Origin")).toBe(403);
        expect(await status({ Origin: "https://evil.example", ...(await t.allowed()) }, { multipart: { file: t.good } }), at("foreign Origin")).toBe(403);

        // 2. anonymous callers get 401 whatever they send (valid multipart, JSON, plain text, malformed multipart, empty)
        expect(await status(withOrigin, { multipart: { file: t.good } }), at("anonymous, valid multipart")).toBe(401);
        expect(await status({ ...JSON_HEADERS }, { data: { file: "x" } }), at("anonymous, JSON body")).toBe(401);
        expect(await status({ ...withOrigin, "Content-Type": "text/plain" }, { data: "just text" }), at("anonymous, text/plain body")).toBe(401);
        expect(await status({ ...withOrigin, "Content-Type": "multipart/form-data" }, { data: "no boundary" }), at("anonymous, multipart without boundary")).toBe(401);
        expect(await status({ ...withOrigin, "Content-Type": boundaryType }, { data: "garbage that is not multipart" }), at("anonymous, malformed multipart body")).toBe(401);
        expect(await status(withOrigin, {}), at("anonymous, no body at all")).toBe(401);

        // 3. signed-in but not allowed: refused (403) before the body or its content type matters
        const denied = await t.denied();
        if (t.name === "member photo") {
          expect(await status({ ...withOrigin, ...denied }, { multipart: { file: t.good } }), at("not an administrator, valid multipart")).toBe(403);
          expect(await status({ ...JSON_HEADERS, ...denied }, { data: { file: "x" } }), at("not an administrator, JSON body")).toBe(403);
        } else {
          expect(await status({ ...JSON_HEADERS, ...denied }, { data: { file: "x" } }), at("not registered, JSON body")).toBe(415); // any signed-in user passes the session check; registration is checked after parsing
        }

        // 4. allowed caller: content type is checked now
        const allowed = await t.allowed();
        expect(await status({ ...JSON_HEADERS, ...allowed }, { data: { file: "x" } }), at("authorized, JSON body")).toBe(415);
        expect(await status({ ...withOrigin, ...allowed, "Content-Type": "text/plain" }, { data: "just text" }), at("authorized, text/plain body")).toBe(415);
        expect(await status({ ...withOrigin, ...allowed, "Content-Type": "multipart/form-data" }, { data: "no boundary" }), at("authorized, multipart without boundary")).toBe(415);

        // 5. allowed caller, multipart: body and file validation keep working
        expect(await status({ ...withOrigin, ...allowed, "Content-Type": boundaryType }, { data: "garbage that is not multipart" }), at("authorized, malformed multipart body")).toBe(400);
        expect(await status({ ...withOrigin, ...allowed }, { multipart: { wrong: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("x") } } }), at("authorized, wrong field name")).toBe(400);
        expect(await status({ ...withOrigin, ...allowed }, { multipart: { file: { name: "evil.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg onload=alert(1)>") } } }), at("authorized, disallowed file type")).toBe(400);
        expect(await status({ ...withOrigin, ...allowed }, { multipart: { file: t.good } }), at("authorized, valid upload")).toBe(201);
      }
      // nothing was stored by any refused request
      expect(await db().submissionFile.count({ where: { submission: { eventId: event.id } } })).toBe(1);
      expect((await db().orgMember.findUniqueOrThrow({ where: { id: member.id } })).photoKey).not.toBeNull();
    } finally {
      await db().orgMember.deleteMany({ where: { id: member.id } });
      await db().submission.deleteMany({ where: { eventId: event.id } });
      await db().event.deleteMany({ where: { id: event.id } });
    }
  });
});
