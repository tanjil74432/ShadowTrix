import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { COOKIE, JSON_HEADERS, ORIGIN, createRawSession, db, expect, post, test, uiLogin, waitForMail, type TestUser } from "./helpers/fixtures";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const DAY = 86_400_000;
const tag = () => randomUUID().slice(0, 6);
const asUser = async (u: TestUser, extra: Record<string, string> = {}) => ({ ...JSON_HEADERS, ...extra, Cookie: `${COOKIE}=${await createRawSession(u.id)}` });
const cookieOnly = async (u: TestUser) => ({ Cookie: `${COOKIE}=${await createRawSession(u.id)}` });
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");

interface SeedOpts { team?: boolean; capacity?: number | null; past?: boolean }

/** A published event owned by `ownerId`. `past` puts the submission deadline in the past so judging is open. */
async function seedEvent(ownerId: string, o: SeedOpts = {}) {
  const t = tag();
  const now = Date.now();
  const timeline = o.past
    ? { registrationOpensAt: new Date(now - 20 * DAY), registrationClosesAt: new Date(now - 12 * DAY), startsAt: new Date(now - 10 * DAY), endsAt: new Date(now + 5 * DAY), submissionDeadline: new Date(now - DAY) }
    : { registrationOpensAt: new Date(now - DAY), registrationClosesAt: new Date(now + 5 * DAY), startsAt: new Date(now + 6 * DAY), endsAt: new Date(now + 12 * DAY), submissionDeadline: new Date(now + 9 * DAY) };
  return db().event.create({
    data: {
      slug: `e2e-tj-${t}`, title: `E2E Team Judging ${t}`, category: "HACKATHON", summary: `Summary of the event ${t}.`, description: "Description of the event that is long enough.",
      status: "PUBLISHED", capacity: o.capacity ?? null, createdById: ownerId, organizers: { create: { userId: ownerId, isLead: true } },
      ...(o.team ? { registrationMode: "TEAM" as const, minTeamSize: 2, maxTeamSize: 3 } : {}),
      ...timeline,
    },
  });
}

async function axeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
}

test.describe("teams: formation, invitations and registration", () => {
  test("a leader creates a team, invites a member by email, the member accepts from the emailed link, and the leader registers the team", async ({ page, browser, request, users }) => {
    const owner = await users.create({ roles: ["ORGANIZER"] });
    const event = await seedEvent(owner.id, { team: true, capacity: 5 });
    const leader = await users.create({ fullName: "Lena Leader" });
    const member = await users.create({ fullName: "Mo Member" });
    const teamName = `Night Owls ${tag()}`;

    // the event page offers team creation, not individual registration
    await uiLogin(page, leader, `/events/${event.slug}`);
    await expect(page.getByRole("heading", { name: "Team registration" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Register for this event" })).toHaveCount(0);
    await page.getByLabel(/^Team name/).fill(teamName);
    await page.getByRole("button", { name: "Create team" }).click();
    await expect(page.getByRole("heading", { level: 1, name: teamName })).toBeVisible();
    const teamId = page.url().split("/teams/")[1];

    // registering a one-person team is refused with the size rule (minimum is 2)
    await page.getByRole("button", { name: "Register this team" }).click();
    await expect(page.getByText(/needs teams of 2 to 3 members/)).toBeVisible();

    await page.getByLabel(/^Email address of the person to invite/).fill(member.email);
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText("Invitation sent.")).toBeVisible();
    const mail = await waitForMail(member.email, /invited you to join a team/);
    const link = new URL(mail.link("team-invitations"));

    // opening the link as a mail scanner would (no session) changes nothing
    expect((await request.get(link.toString())).status()).toBe(200);
    expect((await db().teamInvitation.findFirstOrThrow({ where: { teamId } })).status).toBe("PENDING");

    // the invited person logs in, sees who invited them, and accepts with an explicit click
    const memberPage = await (await browser.newContext()).newPage();
    await uiLogin(memberPage, member, `${link.pathname}${link.search}`);
    await expect(memberPage.getByRole("heading", { level: 1, name: "Team invitation" })).toBeVisible();
    await expect(memberPage.getByText("Lena Leader")).toBeVisible();
    expect((await db().teamInvitation.findFirstOrThrow({ where: { teamId } })).status).toBe("PENDING"); // viewing is not answering
    await memberPage.getByRole("button", { name: "Accept invitation" }).click();
    await expect(memberPage.getByRole("heading", { name: "You joined the team" })).toBeVisible();
    await memberPage.close();

    // the same link cannot be used twice, and nobody else can use it
    const token = link.searchParams.get("token")!;
    const replay = await post(request, "/api/v1/team-invitations/respond", { token, accept: true }, await asUser(member));
    expect(replay.status()).toBe(400);
    expect((await replay.json()).error.code).toBe("invalid_invitation");
    const stranger = await users.create();
    expect((await post(request, "/api/v1/team-invitations/respond", { token, accept: true }, await asUser(stranger))).status()).toBe(400);
    expect((await post(request, "/api/v1/team-invitations/preview", { token }, await asUser(stranger))).status()).toBe(404);

    await page.reload();
    await expect(page.getByRole("heading", { name: /Members \(2 of 3\)/ })).toBeVisible();
    await page.getByRole("button", { name: "Register this team" }).click();
    await expect(page.getByText("Your team is registered and confirmed.")).toBeVisible();
    expect(await db().registration.count({ where: { teamId, status: "CONFIRMED" } })).toBe(2);

    // the member sees the team on their dashboard and may leave only while the team stays large enough
    await page.context().clearCookies();
    await uiLogin(page, member, "/dashboard");
    await expect(page.getByRole("heading", { name: "My teams" })).toBeVisible();
    expect((await post(request, `/api/v1/teams/${teamId}/leave`, {}, await asUser(member))).status()).toBe(409); // registered team needs 2
  });

  test("a participant can decline an invitation from the dashboard; non-members cannot see the team; leaders only manage their own", async ({ page, request, users }) => {
    const owner = await users.create({ roles: ["ORGANIZER"] });
    const event = await seedEvent(owner.id, { team: true });
    const leader = await users.create();
    const invitee = await users.create();
    const outsider = await users.create();
    const created = await post(request, `/api/v1/events/${event.id}/teams`, { name: `Decliners ${tag()}` }, await asUser(leader));
    expect(created.status()).toBe(201);
    const teamId = (await created.json()).id;
    expect((await post(request, `/api/v1/events/${event.id}/teams`, { name: `Second ${tag()}` }, await asUser(leader))).status()).toBe(409); // one team per event
    expect((await post(request, `/api/v1/teams/${teamId}/invitations`, { email: invitee.email }, await asUser(leader))).status()).toBe(201);
    // someone else's team is invisible, and cannot be changed or invited into
    expect((await request.get(`/api/v1/teams/${teamId}`, { headers: await cookieOnly(outsider) })).status()).toBe(404);
    expect((await post(request, `/api/v1/teams/${teamId}/invitations`, { email: outsider.email }, await asUser(outsider))).status()).toBe(404);
    expect((await request.patch(`/api/v1/teams/${teamId}`, { headers: await asUser(outsider), data: { name: "Hijacked" } })).status()).toBe(404);
    expect((await request.delete(`/api/v1/teams/${teamId}`, { headers: await asUser(outsider) })).status()).toBe(404);
    expect((await request.get(`/api/v1/teams/${teamId}`)).status()).toBe(401);
    // invitations are never listed for other addresses
    expect(((await (await request.get("/api/v1/me/invitations", { headers: await cookieOnly(outsider) })).json()) as { items: unknown[] }).items).toHaveLength(0);

    await uiLogin(page, invitee, "/dashboard");
    await expect(page.getByRole("heading", { name: "Team invitations" })).toBeVisible();
    await page.getByRole("button", { name: "Decline" }).click();
    await expect(page.getByRole("heading", { name: "Invitation declined" })).toBeVisible();
    expect(await db().teamMember.count({ where: { teamId } })).toBe(1);
    // CSRF applies here too
    expect((await post(request, "/api/v1/team-invitations/respond", { id: randomUUID(), accept: true }, await asUser(invitee, { Origin: "https://evil.example" }))).status()).toBe(403);
  });
});

test.describe("project submission and private files", () => {
  test("team members share one submission with files, versions and a deadline; files stay private", async ({ page, request, users }) => {
    const owner = await users.create({ roles: ["ORGANIZER"] });
    const event = await seedEvent(owner.id, { team: true });
    const leader = await users.create({ fullName: "Sam Submitter" });
    const mate = await users.create({ fullName: "Tess Teammate" });
    const outsider = await users.create();
    const team = await db().team.create({ data: { eventId: event.id, name: `Shippers ${tag()}`, leaderId: leader.id } });
    for (const [u, role] of [[leader, "LEADER"], [mate, "MEMBER"]] as const) {
      await db().teamMember.create({ data: { teamId: team.id, eventId: event.id, userId: u.id, role } });
      await db().registration.create({ data: { eventId: event.id, userId: u.id, teamId: team.id, status: "CONFIRMED" } });
    }

    await uiLogin(page, leader, `/events/${event.slug}/submission`);
    await expect(page.getByRole("heading", { level: 1, name: "Project submission" })).toBeVisible();
    await page.getByLabel(/^Project title/).fill("Shadow Scanner");
    await page.getByLabel(/^Description/).fill("A scanner that finds shadows in the matrix of data, built by the whole team.");
    await page.getByLabel(/^Repository link/).fill("http://github.com/example/repo"); // not https
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Enter a full link that starts with https://")).toBeVisible();
    await page.getByLabel(/^Repository link/).fill("https://github.com/example/shadow-scanner");
    await page.getByLabel(/^Additional links/).fill("https://slides.example.com/deck");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved. Judges cannot see it yet.")).toBeVisible();

    // files: invalid ones are refused with a reason, valid ones are stored privately
    await page.getByLabel(/^Add a file/).setInputFiles({ name: "run.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
    await page.getByRole("button", { name: "Upload file" }).click();
    await expect(page.getByText(/Files of this type are not allowed/)).toBeVisible();
    await page.getByLabel(/^Add a file/).setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html>not a pdf</html>") });
    await page.getByRole("button", { name: "Upload file" }).click();
    await expect(page.getByText(/does not match its extension/)).toBeVisible();
    await page.getByLabel(/^Add a file/).setInputFiles({ name: "../../Report.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.getByRole("button", { name: "Upload file" }).click();
    await expect(page.getByText("File uploaded.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Report.pdf" })).toBeVisible();

    await page.getByRole("button", { name: "Submit project" }).click();
    await expect(page.getByText("Project submitted.")).toBeVisible();
    await expect(page.getByText("Submitted (version 1)")).toBeVisible();

    // privacy of the stored file
    const sub = await db().submission.findFirstOrThrow({ where: { teamId: team.id }, include: { files: true } });
    const file = sub.files[0];
    expect(file.storageKey).toMatch(/^submissions\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    const url = `/api/v1/submissions/${sub.id}/files/${file.id}`;
    expect((await request.get(url)).status()).toBe(401); // no session
    expect((await request.get(url, { headers: await cookieOnly(outsider) })).status()).toBe(404); // not authorized
    const own = await request.get(url, { headers: await cookieOnly(mate) }); // a teammate
    expect(own.status()).toBe(200);
    expect(own.headers()["content-disposition"]).toContain("attachment");
    expect(own.headers()["content-disposition"]).toContain("Report.pdf");
    expect(own.headers()["x-content-type-options"]).toBe("nosniff");
    expect(own.headers()["cache-control"]).toContain("no-store");
    expect((await own.body()).subarray(0, 5).toString()).toBe("%PDF-");
    for (const guess of [`/storage/${file.storageKey}`, `/.storage/${file.storageKey}`, `/${file.storageKey}`, `/submissions/${sub.id}`]) {
      expect((await request.get(guess)).status(), guess).toBe(404); // there is no public URL for stored files
    }

    // the teammate sees the same submission and resubmits: version 2, history kept
    await page.context().clearCookies();
    await uiLogin(page, mate, `/events/${event.slug}/submission`);
    await expect(page.getByLabel(/^Project title/)).toHaveValue("Shadow Scanner");
    await page.getByLabel(/^Project title/).fill("Shadow Scanner 2");
    await page.getByRole("button", { name: "Resubmit changes" }).click();
    await expect(page.getByText("Resubmitted. A new version was recorded.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Version history" })).toBeVisible();
    await expect(page.getByText(/Version 2 \(current\): Shadow Scanner 2/)).toBeVisible();
    await expect(page.getByText(/Version 1: Shadow Scanner/)).toBeVisible();
    expect(await db().submission.count({ where: { eventId: event.id } })).toBe(1);

    // outsiders (even registered individually elsewhere) cannot read or write it
    expect((await request.get(`/api/v1/submissions/${sub.id}`, { headers: await cookieOnly(outsider) })).status()).toBe(404);
    expect((await request.put(`/api/v1/events/${event.id}/my-submission`, { headers: await asUser(outsider), data: { title: "Hijack", description: "x".repeat(30) } })).status()).toBe(403);

    // the deadline closes everything
    await db().event.update({ where: { id: event.id }, data: { startsAt: new Date(Date.now() - 3 * DAY), registrationClosesAt: new Date(Date.now() - 4 * DAY), registrationOpensAt: new Date(Date.now() - 6 * DAY), submissionDeadline: new Date(Date.now() - DAY) } });
    await page.reload();
    await expect(page.getByText(/The deadline has passed/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Resubmit changes" })).toHaveCount(0);
    const late = await post(request, `/api/v1/events/${event.id}/my-submission/submit`, { title: "Late", description: "x".repeat(30), repoUrl: "https://github.com/a/b" }, await asUser(mate));
    expect(late.status()).toBe(409);
    expect((await late.json()).error.code).toBe("submission_closed");
  });

  test("upload endpoint hygiene: needs a session, an Origin, multipart and a declared size within the limit", async ({ request, users }) => {
    const owner = await users.create({ roles: ["ORGANIZER"] });
    const event = await seedEvent(owner.id);
    const p = await users.create();
    await db().registration.create({ data: { eventId: event.id, userId: p.id, status: "CONFIRMED" } });
    const url = `/api/v1/events/${event.id}/my-submission/files`;
    const multipart = { file: { name: "ok.txt", mimeType: "text/plain", buffer: Buffer.from("hello") } };
    expect((await request.post(url, { multipart })).status()).toBe(403); // no Origin/Sec-Fetch-Site
    expect((await request.post(url, { multipart, headers: { Origin: ORIGIN } })).status()).toBe(401);
    expect((await request.post(url, { multipart, headers: { Origin: "https://evil.example", ...(await cookieOnly(p)) } })).status()).toBe(403);
    expect((await request.post(url, { data: { file: "x" }, headers: { ...JSON_HEADERS, ...(await cookieOnly(p)) } })).status()).toBe(415); // JSON is not an upload
    expect((await request.post(url, { multipart, headers: { Origin: ORIGIN, ...(await cookieOnly(p)) } })).status()).toBe(201);
    const huge = await request.post(url, { multipart: { file: { name: "big.txt", mimeType: "text/plain", buffer: Buffer.alloc(11 * 1024 * 1024, 97) } }, headers: { Origin: ORIGIN, ...(await cookieOnly(p)) } });
    expect(huge.status()).toBe(413);
    expect(await db().submissionFile.count({ where: { submission: { eventId: event.id } } })).toBe(1);
  });
});

test.describe("judging, results and certificates", () => {
  /** Individual event with three submitted projects and a deadline in the past, plus users. */
  async function judgingWorld(users: { create: (o?: { roles?: ("PARTICIPANT" | "ORGANIZER" | "JUDGE" | "ADMIN")[]; fullName?: string }) => Promise<TestUser> }) {
    const organizer = await users.create({ roles: ["ORGANIZER"], fullName: "Olga Organizer" });
    const event = await seedEvent(organizer.id, { past: true });
    const authors: TestUser[] = [];
    const subs: string[] = [];
    for (const name of ["Alpha", "Bravo", "Charlie"]) {
      const u = await users.create({ fullName: `${name} Author` });
      await db().registration.create({ data: { eventId: event.id, userId: u.id, status: "CONFIRMED" } });
      const s = await db().submission.create({ data: { eventId: event.id, ownerId: u.id, title: `${name} Project`, description: `Description of the ${name} project.`, repoUrl: "https://github.com/example/repo", status: "SUBMITTED", submittedAt: new Date(Date.now() - 2 * DAY), currentVersion: 1 } });
      authors.push(u);
      subs.push(s.id);
    }
    const judge = await users.create({ fullName: "Jade Judge" });
    return { organizer, event, authors, subs, judge };
  }

  test("an organizer sets criteria and assigns a judge, the judge scores blind, the results publish only when complete, and certificates verify", async ({ page, browser, request, users }) => {
    const w = await judgingWorld(users);

    // organizer: criteria and judge through the UI
    await uiLogin(page, w.organizer, `/organizer/events/${w.event.id}/judging`);
    await expect(page.getByRole("heading", { level: 1, name: "Judging setup" })).toBeVisible();
    await page.getByLabel(/^Name/).fill("Innovation");
    await page.getByLabel(/^Maximum score/).fill("10");
    await page.getByLabel(/^Weight/).fill("2");
    await page.getByRole("button", { name: "Add criterion" }).click();
    await expect(page.getByText(/Innovation/).first()).toBeVisible();
    await page.getByLabel(/^Name/).fill("Impact");
    await page.getByLabel(/^Maximum score/).fill("100");
    await page.getByRole("button", { name: "Add criterion" }).click();
    await expect(page.getByText(/Impact/).first()).toBeVisible();
    await page.getByLabel(/^Judge's email address/).fill(w.judge.email);
    await page.getByRole("button", { name: "Assign judge" }).click();
    await expect(page.getByText("Judge assigned.")).toBeVisible();
    // a participant of the event cannot be a judge
    await page.getByLabel(/^Judge's email address/).fill(w.authors[0].email);
    await page.getByRole("button", { name: "Assign judge" }).click();
    await expect(page.getByText(/taking part in the event/)).toBeVisible();

    // results cannot be published yet
    await page.goto(`/organizer/events/${w.event.id}/results`);
    await expect(page.getByText(/Not ready to publish/)).toBeVisible();
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Publish results" }).click();
    await expect(page.getByText(/still need finalized scorecards/)).toBeVisible();
    expect(await db().result.count({ where: { eventId: w.event.id, publishedAt: { not: null } } })).toBe(0);

    // the judge (signed out by the role change) scores two projects blind
    const judgePage = await (await browser.newContext()).newPage();
    await uiLogin(judgePage, w.judge, "/judge");
    await expect(judgePage.getByRole("heading", { level: 1, name: "Judge area" })).toBeVisible();
    await judgePage.getByRole("link", { name: w.event.title }).click();
    await expect(judgePage.getByRole("heading", { name: "Projects to score" })).toBeVisible();
    await expect(judgePage.getByText("Alpha Author")).toHaveCount(0); // anonymous
    await judgePage.getByRole("link", { name: "Alpha Project" }).click();
    expect(await judgePage.content()).not.toContain(w.authors[0].email);
    await judgePage.getByLabel(/^Score for Innovation/).fill("11"); // above the maximum
    await judgePage.getByLabel(/^Score for Impact/).fill("90");
    await judgePage.getByRole("button", { name: "Save draft" }).click();
    await expect(judgePage.getByText(/cannot exceed 10/)).toBeVisible();
    await judgePage.getByLabel(/^Score for Innovation/).fill("9");
    await judgePage.getByLabel(/^Feedback for Innovation/).fill("Clever approach to the data problem.");
    await judgePage.getByRole("button", { name: "Save draft" }).click();
    await expect(judgePage.getByText(/Your weighted score would be 90 out of 100/)).toBeVisible();
    judgePage.once("dialog", (d) => void d.accept());
    await judgePage.getByRole("button", { name: "Finalize scorecard" }).click();
    await expect(judgePage.getByText(/Scorecard finalized\. Your weighted score is 90/)).toBeVisible();
    await expect(judgePage.getByText("This scorecard is final.")).toBeVisible();

    // finalizing with a missing criterion is refused and nothing is final
    await judgePage.goto("/judge");
    await judgePage.getByRole("link", { name: w.event.title }).click();
    await judgePage.getByRole("link", { name: "Bravo Project" }).click();
    await judgePage.getByLabel(/^Score for Innovation/).fill("5");
    judgePage.once("dialog", (d) => void d.accept());
    await judgePage.getByRole("button", { name: "Finalize scorecard" }).click();
    await expect(judgePage.getByText(/Score every criterion before finalizing/)).toBeVisible();
    await judgePage.getByLabel(/^Score for Impact/).fill("50");
    judgePage.once("dialog", (d) => void d.accept());
    await judgePage.getByRole("button", { name: "Finalize scorecard" }).click();
    await expect(judgePage.getByText(/Scorecard finalized\. Your weighted score is 50/)).toBeVisible();

    // the third project: finalize through the API (same rules)
    const judgeHeaders = await asUser(w.judge);
    const crit = (await db().judgingCriterion.findMany({ where: { eventId: w.event.id }, orderBy: { name: "asc" } }));
    const impact = crit.find((c) => c.name === "Impact")!.id;
    const innovation = crit.find((c) => c.name === "Innovation")!.id;
    const third = await request.put(`/api/v1/submissions/${w.subs[2]}/scorecard`, { headers: judgeHeaders, data: { scores: [{ criterionId: innovation, score: 5 }, { criterionId: impact, score: 50 }], finalize: true } });
    expect(third.status()).toBe(200);
    const again = await request.put(`/api/v1/submissions/${w.subs[2]}/scorecard`, { headers: judgeHeaders, data: { scores: [{ criterionId: innovation, score: 6 }], finalize: false } });
    expect(again.status()).toBe(409);
    expect((await again.json()).error.code).toBe("scorecard_final");

    // organizer publishes: Alpha wins, Bravo and Charlie tie for second
    await page.goto(`/organizer/events/${w.event.id}/results`);
    await expect(page.getByText(/can be published/)).toBeVisible();
    await expect(page.getByRole("row", { name: /Alpha Project/ })).toContainText("Winner");
    await expect(page.getByRole("row", { name: /T-2.*Bravo Project/ })).toBeVisible();
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Publish results" }).click();
    await expect(page.getByText(/^Published /)).toBeVisible();

    // public leaderboard: ranks, ties and scores, but no judge identities or feedback
    await page.context().clearCookies();
    await page.goto(`/events/${w.event.slug}/results`);
    await expect(page.getByRole("heading", { level: 1, name: "Results" })).toBeVisible();
    await expect(page.getByRole("row", { name: /Alpha Project/ })).toContainText("90");
    await expect(page.getByRole("row", { name: /Bravo Project/ })).toContainText("T-2");
    const html = await page.content();
    for (const secret of [w.judge.email, "Jade Judge", "Clever approach", w.authors[0].email]) expect(html).not.toContain(secret);
    expect((await request.get(`/api/v1/events/by-slug/${w.event.slug}/results`)).status()).toBe(200);

    // scoring is frozen after publication
    const frozen = await request.put(`/api/v1/submissions/${w.subs[0]}/scorecard`, { headers: judgeHeaders, data: { scores: [{ criterionId: innovation, score: 1 }], finalize: false } });
    expect(frozen.status()).toBe(409);

    // the winner sees their own result with anonymous feedback and gets a verifiable certificate
    await page.context().clearCookies();
    await uiLogin(page, w.authors[0], `/events/${w.event.slug}/results`);
    await expect(page.getByRole("heading", { name: "Your result" })).toBeVisible();
    await expect(page.getByText("Clever approach to the data problem.")).toBeVisible();

    await page.goto(`/organizer/events/${w.event.id}/results`); // a participant has no organizer access
    await expect(page.getByRole("heading", { name: /You do not have access/ })).toBeVisible();

    await page.context().clearCookies();
    await uiLogin(page, w.organizer, `/organizer/events/${w.event.id}/results`);
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Issue certificates" }).click();
    await expect(page.getByRole("region", { name: "Issued certificates" })).toBeVisible();
    const cert = await db().certificate.findFirstOrThrow({ where: { userId: w.authors[0].id } });
    expect(cert.type).toBe("WINNER");

    await page.context().clearCookies();
    await page.goto(`/verify/certificate/${cert.publicCode}`);
    await expect(page.getByText("This certificate is genuine")).toBeVisible();
    await expect(page.getByText("Alpha Author")).toBeVisible();
    await page.goto("/verify/certificate/ST-AAAAA-BBBBB-CCCCC");
    await expect(page.getByText("No certificate found")).toBeVisible();
    expect((await request.get(`/api/v1/certificates/verify/${cert.publicCode}`)).status()).toBe(200);
    expect((await request.get("/api/v1/certificates/verify/nonsense")).status()).toBe(404);

    // the PDF: recipient only
    const pdfUrl = `/api/v1/certificates/${cert.id}/pdf`;
    expect((await request.get(pdfUrl)).status()).toBe(401);
    expect((await request.get(pdfUrl, { headers: await cookieOnly(w.authors[1]) })).status()).toBe(404);
    const pdf = await request.get(pdfUrl, { headers: await cookieOnly(w.authors[0]) });
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

    // revocation: the verify page and the recipient's download both reflect it
    const revoke = await post(request, `/api/v1/certificates/${cert.id}/revoke`, { reason: "issued in error" }, await asUser(w.organizer));
    expect(revoke.status()).toBe(200);
    await page.goto(`/verify/certificate/${cert.publicCode}`);
    await expect(page.getByText("This certificate was revoked")).toBeVisible();
    expect((await request.get(pdfUrl, { headers: await cookieOnly(w.authors[0]) })).status()).toBe(410);
  });

  test("authorization matrix: participants, other organizers and unassigned judges cannot reach judging, results or certificate actions", async ({ request, users }) => {
    const w = await judgingWorld(users);
    const otherOrg = await users.create({ roles: ["ORGANIZER"] });
    const stray = await users.create({ roles: ["JUDGE"] }); // JUDGE somewhere else is not enough here
    const p = w.authors[0];
    const crit = (await post(request, `/api/v1/events/${w.event.id}/criteria`, { name: "Quality", maxScore: 10 }, await asUser(w.organizer)));
    expect(crit.status()).toBe(201);
    const criterionId = (await crit.json()).id;
    expect((await post(request, `/api/v1/events/${w.event.id}/judges`, { email: w.judge.email }, await asUser(w.organizer))).status()).toBe(201);

    const attempts: [string, Awaited<ReturnType<typeof asUser>>][] = [];
    for (const who of [p, otherOrg, stray, w.judge]) attempts.push([who.email, await asUser(who)]);
    for (const [who, h] of attempts) {
      const mutating: [string, unknown][] = [
        [`/api/v1/events/${w.event.id}/criteria`, { name: "Hack", maxScore: 10 }],
        [`/api/v1/events/${w.event.id}/judges`, { email: stray.email }],
        [`/api/v1/events/${w.event.id}/results/publish`, {}],
        [`/api/v1/events/${w.event.id}/results/recalculate`, {}],
        [`/api/v1/events/${w.event.id}/certificates/issue`, {}],
        [`/api/v1/submissions/${w.subs[0]}/disqualify`, { reason: "just because" }],
        [`/api/v1/submissions/${w.subs[0]}/scorecard/reopen`, { judgeId: w.judge.id, reason: "just because" }],
      ];
      for (const [url, body] of mutating) {
        const res = await post(request, url, body, h);
        expect([403, 404], `${who} ${url} -> ${res.status()}`).toContain(res.status());
      }
      expect([403, 404], `${who} patch`).toContain((await request.patch(`/api/v1/events/${w.event.id}/criteria/${criterionId}`, { headers: h, data: { weight: 9 } })).status());
      expect([403, 404], `${who} delete`).toContain((await request.delete(`/api/v1/events/${w.event.id}/criteria/${criterionId}`, { headers: h })).status());
      expect([403, 404], `${who} standings`).toContain((await request.get(`/api/v1/events/${w.event.id}/results`, { headers: await cookieOnly(attemptsUser(who, [p, otherOrg, stray, w.judge])) })).status());
      expect([403, 404], `${who} certificates`).toContain((await request.get(`/api/v1/events/${w.event.id}/certificates`, { headers: await cookieOnly(attemptsUser(who, [p, otherOrg, stray, w.judge])) })).status());
    }
    // scoring: unassigned judge and the participant get 404; the assigned judge works
    const body = { scores: [{ criterionId, score: 5 }], finalize: false };
    expect((await request.put(`/api/v1/submissions/${w.subs[1]}/scorecard`, { headers: await asUser(stray), data: body })).status()).toBe(404);
    expect((await request.put(`/api/v1/submissions/${w.subs[1]}/scorecard`, { headers: await asUser(p), data: body })).status()).toBe(404);
    expect((await request.get(`/api/v1/submissions/${w.subs[1]}/scorecard`, { headers: await cookieOnly(stray) })).status()).toBe(404);
    expect((await request.put(`/api/v1/submissions/${w.subs[1]}/scorecard`, { headers: await asUser(w.judge), data: body })).status()).toBe(200);
    // boundary and shape checks
    expect((await request.put(`/api/v1/submissions/${w.subs[1]}/scorecard`, { headers: await asUser(w.judge), data: { scores: [{ criterionId, score: 10.5 }] } })).status()).toBe(400);
    expect((await request.put(`/api/v1/submissions/${w.subs[1]}/scorecard`, { headers: await asUser(w.judge), data: { scores: [{ criterionId, score: -1 }] } })).status()).toBe(400);
    expect((await request.put(`/api/v1/submissions/${w.subs[1]}/scorecard`, { headers: await asUser(w.judge), data: { scores: [] } })).status()).toBe(400);
    expect((await request.put(`/api/v1/submissions/${w.subs[1]}/scorecard`, { headers: JSON_HEADERS, data: body })).status()).toBe(401);
    // published-results endpoints: unpublished looks like nothing, and certificate issuing needs published results
    expect((await request.get(`/api/v1/events/by-slug/${w.event.slug}/results`)).status()).toBe(404);
    expect((await post(request, `/api/v1/events/${w.event.id}/certificates/issue`, {}, await asUser(w.organizer))).status()).toBe(409);
    expect((await post(request, `/api/v1/events/${w.event.id}/results/publish`, {}, await asUser(w.organizer))).status()).toBe(409);
    expect((await request.get(`/api/v1/events/${w.event.id}/judging/submissions`, { headers: await cookieOnly(p) })).status()).toBe(404);
    // the organizer cannot score either (not a judge)
    expect((await request.put(`/api/v1/submissions/${w.subs[1]}/scorecard`, { headers: await asUser(w.organizer), data: body })).status()).toBe(404);
  });
});

function attemptsUser(email: string, list: TestUser[]): TestUser {
  return list.find((u) => u.email === email)!;
}

test.describe("accessibility of team, submission, judging and results pages", () => {
  for (const vp of [{ name: "mobile", width: 360, height: 800 }, { name: "desktop", width: 1440, height: 900 }]) {
    test(`${vp.name}: pages have no WCAG 2.2 AA violations or overflow`, async ({ page, users }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const noOverflow = async (label: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${label} overflow`).toBeLessThanOrEqual(0);

      const organizer = await users.create({ roles: ["ORGANIZER"], fullName: "Axe Organizer" });
      const event = await seedEvent(organizer.id, { team: true, past: true });
      const judge = await users.create({ fullName: "Axe Judge" });
      const leader = await users.create({ fullName: "Axe Leader" });
      const team = await db().team.create({ data: { eventId: event.id, name: `Axe Team ${tag()}`, leaderId: leader.id } });
      await db().teamMember.create({ data: { teamId: team.id, eventId: event.id, userId: leader.id, role: "LEADER" } });
      await db().registration.create({ data: { eventId: event.id, userId: leader.id, teamId: team.id, status: "CONFIRMED" } });
      const sub = await db().submission.create({ data: { eventId: event.id, teamId: team.id, ownerId: leader.id, title: "Axe Project", description: "Description of the axe project, long enough.", repoUrl: "https://github.com/example/axe", status: "SUBMITTED", submittedAt: new Date(Date.now() - 2 * DAY), currentVersion: 1 } });
      await db().submissionVersion.create({ data: { submissionId: sub.id, version: 1, snapshot: { title: "Axe Project", files: [] }, createdById: leader.id } });
      await db().judgingCriterion.create({ data: { eventId: event.id, name: "Quality", maxScore: 10, weight: 1 } });
      await db().judgeAssignment.create({ data: { eventId: event.id, judgeId: judge.id } });
      await db().userRoleAssignment.create({ data: { userId: judge.id, role: "JUDGE", eventId: event.id } });

      // public pages
      await page.goto("/verify");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await axeClean(page, "/verify");
      await noOverflow("/verify");
      await page.goto("/verify/certificate/ST-AAAAA-BBBBB-CCCCC");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await axeClean(page, "verify not found");

      // participant pages
      await uiLogin(page, leader, "/dashboard");
      await expect(page).toHaveURL(/\/dashboard$/);
      for (const path of [`/teams/${team.id}`, `/events/${event.slug}/submission`, `/events/${event.slug}`, "/dashboard"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await axeClean(page, path);
        await noOverflow(path);
      }
      await page.goto(`/team-invitations?token=${"a".repeat(43)}`);
      await expect(page.getByRole("heading", { level: 1, name: "Team invitation" })).toBeVisible();
      await axeClean(page, "invitation not found");

      // judge pages
      await page.context().clearCookies();
      await uiLogin(page, judge, "/judge");
      await expect(page.getByRole("heading", { level: 1, name: "Judge area" })).toBeVisible();
      for (const path of ["/judge", `/judge/events/${event.id}`, `/judge/submissions/${sub.id}`]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await axeClean(page, path);
        await noOverflow(path);
      }

      // organizer pages
      await page.context().clearCookies();
      await uiLogin(page, organizer, "/organizer");
      await expect(page.getByRole("heading", { level: 1, name: "Organizer dashboard" })).toBeVisible();
      for (const path of [`/organizer/events/${event.id}`, `/organizer/events/${event.id}/judging`, `/organizer/events/${event.id}/results`, `/organizer/events/${event.id}/submissions/${sub.id}`]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await axeClean(page, path);
        await noOverflow(path);
      }
    });
  }
});
