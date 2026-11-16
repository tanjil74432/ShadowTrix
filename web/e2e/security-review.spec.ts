import { randomUUID } from "node:crypto";
import { COOKIE, JSON_HEADERS, createRawSession, db, expect, post, test, uiLogin, type TestUser } from "./helpers/fixtures";

const DAY = 86_400_000;
const tag = () => randomUUID().slice(0, 6);
const asUser = async (u: TestUser) => ({ ...JSON_HEADERS, Cookie: `${COOKIE}=${await createRawSession(u.id)}` });
const cookieOnly = async (u: TestUser) => ({ Cookie: `${COOKIE}=${await createRawSession(u.id)}` });
const XSS = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "<svg/onload=alert(1)>"];

test.describe("security review: injection and output encoding", () => {
  test("markup in every free-text input is rejected and nothing is stored", async ({ request, users }) => {
    const organizer = await users.create({ roles: ["ORGANIZER"] });
    const admin = await users.create({ roles: ["ADMIN"] });
    const person = await users.create();
    const now = Date.now();
    const event = await db().event.create({
      data: {
        slug: `e2e-sec-${tag()}`, title: `E2E Sec ${tag()}`, category: "WORKSHOP", summary: "Summary of the security event.", description: "Description of the security event, long enough.", status: "PUBLISHED",
        registrationMode: "TEAM", minTeamSize: 1, maxTeamSize: 3, createdById: organizer.id, organizers: { create: { userId: organizer.id, isLead: true } },
        registrationOpensAt: new Date(now - DAY), registrationClosesAt: new Date(now + 5 * DAY), startsAt: new Date(now + 6 * DAY), endsAt: new Date(now + 8 * DAY),
      },
    });
    const year = new Date().getUTCFullYear() + 2;
    const eventBody = { category: "WORKSHOP", summary: "A valid summary for the event.", description: "A valid description that is long enough.", registrationOpensAt: `${year}-01-01T00:00:00Z`, registrationClosesAt: `${year}-02-01T00:00:00Z`, startsAt: `${year}-02-10T00:00:00Z`, endsAt: `${year}-02-11T00:00:00Z` };
    const as = { person: await asUser(person), organizer: await asUser(organizer), admin: await asUser(admin) };
    let attempts = 0;
    for (const xss of XSS) {
      const probes: [string, string, unknown, keyof typeof as][] = [
        ["PATCH", "/api/v1/me/profile", { fullName: xss }, "person"],
        ["PATCH", "/api/v1/me/profile", { fullName: "Valid Name", bio: xss }, "person"],
        ["POST", "/api/v1/events", { ...eventBody, title: xss }, "organizer"],
        ["POST", "/api/v1/events", { ...eventBody, title: "Valid title here", summary: xss }, "organizer"],
        ["POST", "/api/v1/events", { ...eventBody, title: "Valid title here", description: xss + " padding text" }, "organizer"],
        ["POST", `/api/v1/events/${event.id}/teams`, { name: xss }, "person"],
        ["POST", `/api/v1/events/${event.id}/teams`, { name: "Valid Team Name", description: xss }, "person"],
        ["POST", `/api/v1/events/${event.id}/criteria`, { name: xss, maxScore: 10 }, "organizer"],
        ["POST", "/api/v1/admin/organizations", { name: xss }, "admin"],
        ["POST", "/api/v1/admin/members", { fullName: xss }, "admin"],
        ["POST", "/api/v1/admin/leadership/units", { name: xss }, "admin"],
      ];
      for (const [method, url, body, who] of probes) {
        const res = method === "PATCH" ? await request.patch(url, { headers: as[who], data: body }) : await post(request, url, body, as[who]);
        expect(res.status(), `${method} ${url} ${JSON.stringify(body).slice(0, 60)}`).toBe(400);
        attempts++;
      }
    }
    expect(attempts).toBe(XSS.length * 11);
    // links must be https: javascript:, data: and credentials are refused
    const reg = await db().registration.create({ data: { eventId: event.id, userId: person.id, status: "CONFIRMED" } });
    void reg;
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "http://github.com/a/b", "https://user:pw@github.com/a/b"]) {
      const res = await request.put(`/api/v1/events/${event.id}/my-submission`, { headers: as.person, data: { title: "Valid title", description: "x".repeat(30), repoUrl: bad } });
      expect([400, 403], bad).toContain(res.status());
    }
    const stored = await db().$queryRaw<{ c: bigint }[]>`SELECT (SELECT count(*) FROM users WHERE full_name ~ '[<>]' OR bio ~ '[<>]') + (SELECT count(*) FROM events WHERE title ~ '[<>]') + (SELECT count(*) FROM teams WHERE name ~ '[<>]') + (SELECT count(*) FROM organizations WHERE name ~ '[<>]') AS c`;
    expect(Number(stored[0].c)).toBe(0);
  });

  test("allowed special characters are encoded on the page, never interpreted", async ({ page, request, users }) => {
    const u = await users.create();
    const name = `Tom & "Jerry" O'Neil ${tag()}`;
    expect((await request.patch("/api/v1/me/profile", { headers: await asUser(u), data: { fullName: name, bio: "Uses a < b is impossible, but a & b is fine." } })).status()).toBe(400); // '<' is refused
    expect((await request.patch("/api/v1/me/profile", { headers: await asUser(u), data: { fullName: name, bio: "Fish & chips, \"quoted\", it's fine." } })).status()).toBe(200);
    await uiLogin(page, u, "/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Welcome, ${name}`);
    const html = await page.content();
    expect(html).not.toContain(`Welcome, ${name}</h1>`.replace("&", "&amp;").replace(/"/g, "\"")) ; // the raw, unencoded text is not what the server sent
    await page.goto("/dashboard/settings");
    await expect(page.getByLabel(/^Short bio/)).toHaveValue("Fish & chips, \"quoted\", it's fine.");
  });

  test("SQL-looking input is inert in every search", async ({ request, users }) => {
    const admin = await users.create({ roles: ["ADMIN"] });
    const h = await cookieOnly(admin);
    const evil = encodeURIComponent("'; DROP TABLE users; --");
    for (const url of [`/api/v1/events?q=${evil}`, `/api/v1/admin/users?q=${evil}`, `/api/v1/admin/events?q=${evil}`, `/api/v1/admin/audit?actor=${evil}&action=${evil}`, `/api/v1/admin/members?q=${evil}`, `/api/v1/events?q=%00`, `/api/v1/admin/users?q=%00`, `/api/v1/events?category=${evil}`]) {
      const res = await request.get(url, { headers: h });
      expect([200, 400], url).toContain(res.status());
    }
    expect(await db().user.count({ where: { id: admin.id } })).toBe(1); // still here
  });
});

test.describe("security review: response headers", () => {
  test("pages, APIs and downloads carry the security headers; the framework is not advertised", async ({ request }) => {
    for (const path of ["/", "/events", "/login", "/verify", "/api/v1/events", "/api/health", "/verify-email?token=x", "/does-not-exist"]) {
      const res = await request.get(path);
      const h = res.headers();
      expect(h["x-powered-by"], path).toBeUndefined();
      expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["x-frame-options"], path).toBe("DENY");
      expect(h["content-security-policy"], path).toContain("frame-ancestors 'none'");
      expect(h["strict-transport-security"], path).toContain("max-age=");
      expect(h["referrer-policy"], path).toBeTruthy();
      expect(h["permissions-policy"], path).toContain("camera=()");
    }
    const token = await request.get("/verify-email?token=x");
    expect(token.headers()["referrer-policy"]).toBe("no-referrer");
    expect(token.headers()["cache-control"]).toContain("no-store");
    expect((await request.get("/api/v1/events")).headers()["cache-control"]).toContain("no-store");
  });

  test("errors never leak internals: no stack traces, no SQL, no file paths", async ({ request, users }) => {
    const u = await users.create();
    const responses = [
      await request.post("/api/v1/auth/login", { headers: JSON_HEADERS, data: "{not json" }),
      await request.get("/api/v1/events/by-slug/Not%20A%20Slug"),
      await request.get(`/api/v1/submissions/${randomUUID()}`, { headers: await cookieOnly(u) }),
      await request.get("/api/v1/events?pageSize=99999"),
      await request.put("/api/v1/auth/login"),
    ];
    for (const r of responses) {
      const text = await r.text();
      expect(text).not.toMatch(/at\s+\S+\s+\(|node_modules|\.ts:\d+|prisma|SELECT |INSERT |ECONNREFUSED|stack/i);
      expect(r.status()).toBeLessThan(500);
    }
  });
});

test.describe("security review: object-level authorization sweep (IDOR)", () => {
  test("a stranger and another organizer are refused on every object of a team event, anonymous gets 401", async ({ request, users }) => {
    const owner = await users.create({ roles: ["ORGANIZER"] });
    const leader = await users.create();
    const mate = await users.create();
    const judge = await users.create();
    const stranger = await users.create();
    const otherOrg = await users.create({ roles: ["ORGANIZER"] });
    const now = Date.now();
    const event = await db().event.create({
      data: {
        slug: `e2e-idor-${tag()}`, title: `E2E IDOR ${tag()}`, category: "HACKATHON", summary: "Summary of the idor event.", description: "Description of the idor event, long enough.", status: "PUBLISHED",
        registrationMode: "TEAM", minTeamSize: 2, maxTeamSize: 3, createdById: owner.id, organizers: { create: { userId: owner.id, isLead: true } },
        registrationOpensAt: new Date(now - 20 * DAY), registrationClosesAt: new Date(now - 12 * DAY), startsAt: new Date(now - 10 * DAY), endsAt: new Date(now + 5 * DAY), submissionDeadline: new Date(now - DAY),
      },
    });
    const team = await db().team.create({ data: { eventId: event.id, name: `IDOR Team ${tag()}`, leaderId: leader.id } });
    for (const [u, role] of [[leader, "LEADER"], [mate, "MEMBER"]] as const) {
      await db().teamMember.create({ data: { teamId: team.id, eventId: event.id, userId: u.id, role } });
      await db().registration.create({ data: { eventId: event.id, userId: u.id, teamId: team.id, status: "CONFIRMED" } });
    }
    const sub = await db().submission.create({ data: { eventId: event.id, teamId: team.id, ownerId: leader.id, title: "IDOR Project", description: "Description of the project.", repoUrl: "https://github.com/a/b", status: "SUBMITTED", submittedAt: new Date(now - 2 * DAY), currentVersion: 1 } });
    const file = await db().submissionFile.create({ data: { submissionId: sub.id, storageKey: `submissions/${sub.id}/${randomUUID()}`, originalName: "a.txt", mimeType: "text/plain", sizeBytes: 1 } });
    const crit = await db().judgingCriterion.create({ data: { eventId: event.id, name: "Q", maxScore: 10, weight: 1 } });
    await db().judgeAssignment.create({ data: { eventId: event.id, judgeId: judge.id } });
    const cert = await db().certificate.create({ data: { publicCode: `ST-IDOR-${tag()}`, eventId: event.id, userId: leader.id, type: "PARTICIPATION", recipientName: "Leader" } });
    const invitation = await db().teamInvitation.create({ data: { teamId: team.id, inviterId: leader.id, inviteeEmail: "someone@example.test", tokenHash: randomUUID(), expiresAt: new Date(now + DAY) } });

    const reads = [
      `/api/v1/teams/${team.id}`, `/api/v1/submissions/${sub.id}`, `/api/v1/submissions/${sub.id}/versions`, `/api/v1/submissions/${sub.id}/files/${file.id}`, `/api/v1/submissions/${sub.id}/scorecard`,
      `/api/v1/events/${event.id}/registrations`, `/api/v1/events/${event.id}/submissions`, `/api/v1/events/${event.id}/results`, `/api/v1/events/${event.id}/certificates`, `/api/v1/events/${event.id}/judges`,
      `/api/v1/events/${event.id}/criteria`, `/api/v1/certificates/${cert.id}/pdf`, `/api/v1/events/${event.id}/judging/submissions`
    ];
    const writes: [string, string, unknown][] = [
      ["PATCH", `/api/v1/teams/${team.id}`, { name: "Hijacked" }], ["DELETE", `/api/v1/teams/${team.id}`, undefined], ["POST", `/api/v1/teams/${team.id}/invitations`, { email: "x@example.test" }],
      ["DELETE", `/api/v1/teams/${team.id}/invitations/${invitation.id}`, undefined], ["DELETE", `/api/v1/teams/${team.id}/members/${mate.id}`, undefined], ["POST", `/api/v1/teams/${team.id}/leave`, {}],
      ["POST", `/api/v1/teams/${team.id}/registration`, {}], ["DELETE", `/api/v1/teams/${team.id}/registration`, undefined],
      ["PATCH", `/api/v1/events/${event.id}`, { title: "Hijacked title" }], ["POST", `/api/v1/events/${event.id}/status`, { action: "cancel" }], ["POST", `/api/v1/events/${event.id}/results/publish`, {}],
      ["POST", `/api/v1/events/${event.id}/certificates/issue`, {}], ["POST", `/api/v1/certificates/${cert.id}/revoke`, { reason: "just because" }], ["POST", `/api/v1/submissions/${sub.id}/disqualify`, { reason: "just because" }],
      ["PUT", `/api/v1/submissions/${sub.id}/scorecard`, { scores: [{ criterionId: crit.id, score: 5 }] }], ["POST", `/api/v1/events/${event.id}/criteria`, { name: "Hack", maxScore: 5 }],
      ["POST", `/api/v1/events/${event.id}/judges`, { email: stranger.email }], ["PUT", `/api/v1/events/${event.id}/my-submission`, { title: "Hijack", description: "x".repeat(30), repoUrl: "https://github.com/a/b" }],
      ["DELETE", `/api/v1/events/${event.id}/my-submission/files/${file.id}`, undefined],
    ];
    const call = (method: string, url: string, body: unknown, headers: Record<string, string>) => request.fetch(url, { method, headers, ...(body === undefined ? {} : { data: body }) });

    for (const url of reads) expect((await call("GET", url, undefined, {})).status(), `anon GET ${url}`).toBe(401);
    for (const [method, url, body] of writes) expect((await call(method, url, body, JSON_HEADERS)).status(), `anon ${method} ${url}`).toBe(401);

    for (const who of [stranger, otherOrg]) {
      const label = who === stranger ? "stranger" : "other organizer";
      for (const url of reads) {
        const s = (await call("GET", url, undefined, await cookieOnly(who))).status();
        expect([403, 404], `${label} GET ${url} -> ${s}`).toContain(s);
      }
      for (const [method, url, body] of writes) {
        const s = (await call(method, url, body, await asUser(who))).status();
        expect([403, 404], `${label} ${method} ${url} -> ${s}`).toContain(s);
      }
    }
    // "my submission" is always the caller's own: a stranger simply has none
    for (const who of [stranger, otherOrg]) {
      const mine = await call("GET", `/api/v1/events/${event.id}/my-submission`, undefined, await cookieOnly(who));
      expect(mine.status()).toBe(200);
      expect((await mine.json()).submission).toBeNull();
    }
    // a team member (not the leader) may read the team and submission but cannot lead
    expect((await call("GET", `/api/v1/teams/${team.id}`, undefined, await cookieOnly(mate))).status()).toBe(200);
    for (const [method, url, body] of [["PATCH", `/api/v1/teams/${team.id}`, { name: "Hijacked" }], ["DELETE", `/api/v1/teams/${team.id}`, undefined], ["POST", `/api/v1/teams/${team.id}/invitations`, { email: "x@example.test" }], ["DELETE", `/api/v1/teams/${team.id}/members/${leader.id}`, undefined]] as [string, string, unknown][]) {
      expect((await call(method, url, body, await asUser(mate))).status(), `member ${method} ${url}`).toBe(403);
    }
    // nothing changed
    expect(await db().team.findUniqueOrThrow({ where: { id: team.id } })).toMatchObject({ status: "ACTIVE" });
    expect((await db().team.findUniqueOrThrow({ where: { id: team.id } })).name).not.toBe("Hijacked");
    expect((await db().event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe("PUBLISHED");
    expect(await db().teamMember.count({ where: { teamId: team.id } })).toBe(2);
    expect((await db().certificate.findUniqueOrThrow({ where: { id: cert.id } })).revokedAt).toBeNull();
  });
});
