import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { db, expect, test, uiLogin } from "./helpers/fixtures";

/**
 * Captures the administration pages with real (seeded) data for the documentation. Skipped unless ADMIN_SHOTS=1:
 *   ADMIN_SHOTS=1 npx playwright test --project=chromium e2e/admin-screenshots.spec.ts
 * Images go to ../docs/reports/admin-panel/ (desktop and phone width).
 */
const OUT = "../docs/reports/admin-panel";
const DAY = 86_400_000;
const tag = () => randomUUID().slice(0, 4);
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const code = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

test.skip(!process.env.ADMIN_SHOTS, "documentation screenshots only (ADMIN_SHOTS=1)");

test("capture the administration pages", async ({ page, users }) => {
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  const admin = await users.create({ roles: ["ADMIN"], fullName: "Amina Admin" });
  const owner = await users.create({ roles: ["ORGANIZER"], fullName: "Omar Organizer" });
  const lead = await users.create({ fullName: "Lena Leader" });
  const mate = await users.create({ fullName: "Mika Member" });
  const judge = await users.create({ roles: ["JUDGE"], fullName: "Jules Judge" });
  const now = Date.now();
  const mk = (title: string, extra: Record<string, unknown>) => db().event.create({
    data: { slug: `e2e-shot-${tag()}`, title, category: "HACKATHON", summary: "A demonstration event.", description: "Build something useful in a weekend. Teams of up to three.", createdById: owner.id,
      registrationOpensAt: new Date(now - 9 * DAY), registrationClosesAt: new Date(now - 2 * DAY), startsAt: new Date(now - DAY), endsAt: new Date(now + 5 * DAY), organizers: { create: { userId: owner.id, isLead: true } }, ...extra },
  });
  const live = await mk("E2E Demo Hackathon", { status: "PUBLISHED", registrationMode: "TEAM", minTeamSize: 1, maxTeamSize: 3, submissionDeadline: new Date(now + DAY), judgingStartsAt: new Date(now + 2 * DAY), judgingEndsAt: new Date(now + 4 * DAY), resultsPublishedAt: new Date() });
  await mk("E2E Climate Datathon", { reviewStatus: "SUBMITTED" });
  await mk("E2E Robotics Workshop", { reviewStatus: "CHANGES_REQUESTED", reviewNote: "Please add a schedule." });
  const team = await db().team.create({ data: { eventId: live.id, name: "E2E Rocket Squad", leaderId: lead.id } });
  await db().teamMember.createMany({ data: [{ teamId: team.id, eventId: live.id, userId: lead.id, role: "LEADER" }, { teamId: team.id, eventId: live.id, userId: mate.id }] });
  await db().teamInvitation.create({ data: { teamId: team.id, inviterId: lead.id, inviteeEmail: "guest@example.test", tokenHash: randomUUID() + randomUUID(), expiresAt: new Date(now + DAY) } });
  const sub = await db().submission.create({ data: { eventId: live.id, ownerId: lead.id, teamId: team.id, title: "E2E Orbit Planner", description: "Plans satellite passes.", repoUrl: "https://example.test/repo", status: "SCORED", submittedAt: new Date(), currentVersion: 2 } });
  await db().submissionFile.create({ data: { submissionId: sub.id, storageKey: `submissions/${sub.id}/${randomUUID()}`, originalName: "pitch-deck.pdf", mimeType: "application/pdf", sizeBytes: 482_113, sha256: "c".repeat(64) } });
  const crit = await db().judgingCriterion.create({ data: { eventId: live.id, name: "Impact", maxScore: 10, weight: 2 } });
  await db().judgeAssignment.create({ data: { eventId: live.id, judgeId: judge.id } });
  await db().score.create({ data: { submissionId: sub.id, judgeId: judge.id, criterionId: crit.id, score: 9, finalizedAt: new Date() } });
  await db().result.create({ data: { eventId: live.id, submissionId: sub.id, finalScore: 9, rank: 1, award: "WINNER", publishedAt: new Date() } });
  await db().certificate.create({ data: { publicCode: `ST-${code()}-${code()}-${code()}`, eventId: live.id, userId: lead.id, type: "WINNER", recipientName: "Lena Leader", issuedById: owner.id } });
  const ann = await db().announcement.create({ data: { title: "E2E Welcome to the demo", body: "Hackathon check-in opens at 09:00 UTC.", audience: "ALL", authorId: admin.id, updatedById: admin.id, publishedAt: new Date() } });
  try {
    await uiLogin(page, admin, "/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Administration" })).toBeVisible();
    const pages: [string, string][] = [
      ["01-overview", "/admin"], ["02-event-approvals", "/admin/event-approvals"], ["03-event-review", `/admin/event-approvals/${(await db().event.findFirstOrThrow({ where: { title: "E2E Climate Datathon" } })).id}`], ["04-teams", "/admin/teams"], ["05-team-detail", `/admin/teams/${team.id}`],
      ["06-submissions", "/admin/submissions"], ["07-submission-detail", `/admin/submissions/${sub.id}`], ["08-judging", "/admin/judging"], ["09-judging-detail", `/admin/judging/${live.id}`],
      ["10-results", "/admin/results"], ["11-results-detail", `/admin/results/${live.id}`], ["12-certificates", "/admin/certificates"], ["13-announcements", "/admin/announcements"], ["14-announcement-detail", `/admin/announcements/${ann.id}`],
      ["15-maintenance", "/admin/maintenance"], ["16-settings", "/admin/settings"],
    ];
    for (const [name, width, height] of [["desktop", 1440, 900], ["phone", 390, 844]] as const) {
      await page.setViewportSize({ width, height });
      for (const [file, path] of pages) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${OUT}/${file}-${name}.png`, fullPage: name === "desktop" ? false : true });
      }
    }
  } finally {
    await db().announcement.deleteMany({ where: { id: ann.id } });
  }
});
