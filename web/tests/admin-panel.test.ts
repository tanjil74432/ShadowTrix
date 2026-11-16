import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { getAdminOverview, getAdminResults, getAdminSubmission, getAdminTeam, getJudgingEvent, getJudgingOverview, judgingQuerySchema, listAdminCertificates, certificatesQuerySchema, listAdminSubmissions, listAdminTeams, maskEmail, resultsQuerySchema, listAdminResults, submissionsQuerySchema, teamsQuerySchema } from "@/server/modules/admin/admin-ops.service";
import { createAnnouncement, deleteAnnouncement, getAnnouncementAdmin, listAnnouncementsAdmin, listVisibleAnnouncements, publishAnnouncement, announcementSchema, unpublishAnnouncement, updateAnnouncement } from "@/server/modules/admin/announcements.service";
import { getEventForReview, listEventReviews, reviewEvent, reviewQuerySchema, reviewSchema, setApprovalRequired, submitEventForReview } from "@/server/modules/admin/event-review.service";
import { assertNotInMaintenance, getMaintenanceState, getPlatformStatus, maintenanceSchema, setMaintenance } from "@/server/modules/admin/maintenance.service";
import { createEvent, setEventStatus } from "@/server/modules/events/events.service";
import { actorOf, cleanup, createUser } from "./helpers/auth-harness";
import { eventInput, organizer, participant } from "./helpers/event-fixtures";

const db = () => getDb();
const admin = async () => actorOf(await createUser({ roles: ["PARTICIPANT", "ADMIN"] }));
const req = (method: string, path: string) => new Request(`http://localhost:3000${path}`, { method });

beforeEach(async () => {
  await db().siteSetting.deleteMany({ where: { key: { in: ["maintenance_mode", "event_approval_required"] } } });
  await getMaintenanceState(true);
});
afterEach(async () => {
  await db().siteSetting.deleteMany({ where: { key: { in: ["maintenance_mode", "event_approval_required"] } } });
  await db().announcement.deleteMany({ where: { title: { startsWith: "vt " } } });
  await getMaintenanceState(true);
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await db().$disconnect();
});

const fiveCalls = (a: Awaited<ReturnType<typeof admin>>) => ({
  overview: () => getAdminOverview(a),
  teams: () => listAdminTeams(a, teamsQuerySchema.parse({})),
  team: () => getAdminTeam(a, crypto.randomUUID()),
  submissions: () => listAdminSubmissions(a, submissionsQuerySchema.parse({})),
  submission: () => getAdminSubmission(a, crypto.randomUUID()),
  judging: () => getJudgingOverview(a, judgingQuerySchema.parse({})),
  judgingEvent: () => getJudgingEvent(a, crypto.randomUUID()),
  results: () => listAdminResults(a, resultsQuerySchema.parse({})),
  resultsEvent: () => getAdminResults(a, crypto.randomUUID()),
  certificates: () => listAdminCertificates(a, certificatesQuerySchema.parse({})),
  reviews: () => listEventReviews(a, reviewQuerySchema.parse({})),
  review: () => getEventForReview(a, crypto.randomUUID()),
  decide: () => reviewEvent(a, crypto.randomUUID(), { decision: "approve" }),
  approvalSetting: () => setApprovalRequired(a, true),
  announcements: () => listAnnouncementsAdmin(a, { page: 1, pageSize: 10 }),
  announcement: () => getAnnouncementAdmin(a, crypto.randomUUID()),
  createAnn: () => createAnnouncement(a, announcementSchema.parse({ title: "vt nope", body: "x" })),
  updateAnn: () => updateAnnouncement(a, crypto.randomUUID(), announcementSchema.parse({ title: "vt nope", body: "x" })),
  publishAnn: () => publishAnnouncement(a, crypto.randomUUID(), undefined),
  unpublishAnn: () => unpublishAnnouncement(a, crypto.randomUUID()),
  deleteAnn: () => deleteAnnouncement(a, crypto.randomUUID()),
  status: () => getPlatformStatus(a),
  maintenance: () => setMaintenance(a, { enabled: true }),
});

describe("every administration service refuses everyone who is not a platform administrator", () => {
  it.each(["PARTICIPANT", "ORGANIZER", "JUDGE"] as const)("a %s is refused by all of them (403)", async (role) => {
    const actor = actorOf(await createUser({ roles: role === "PARTICIPANT" ? ["PARTICIPANT"] : ["PARTICIPANT", role] }));
    for (const [name, call] of Object.entries(fiveCalls(actor))) {
      await expect(call(), name).rejects.toMatchObject({ status: 403 });
    }
    expect(await getMaintenanceState(true)).toMatchObject({ enabled: false });
    expect(await db().announcement.count({ where: { title: "vt nope" } })).toBe(0);
    expect(await db().siteSetting.count({ where: { key: "event_approval_required" } })).toBe(0);
  });

  it("an event-scoped ADMIN grant is not platform administration", async () => {
    const owner = await organizer();
    const e = await createEvent(owner.actor, eventInput());
    const u = await createUser();
    await db().userRoleAssignment.create({ data: { userId: u.id, role: "ADMIN", eventId: e.id } });
    const actor = actorOf(await db().user.findUniqueOrThrow({ where: { id: u.id }, include: { roles: true } }));
    await expect(getAdminOverview(actor)).rejects.toMatchObject({ status: 403 });
    await expect(reviewEvent(actor, e.id, { decision: "approve" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("event review is separate from publishing", () => {
  it("a reason is required to reject or request changes, and only a submitted event can be decided, once", async () => {
    expect(reviewSchema.safeParse({ decision: "reject" }).success).toBe(false);
    expect(reviewSchema.safeParse({ decision: "reject", reason: "no" }).success).toBe(false);
    expect(reviewSchema.safeParse({ decision: "request_changes", reason: "  " }).success).toBe(false);
    expect(reviewSchema.safeParse({ decision: "approve" }).success).toBe(true);
    expect(reviewSchema.safeParse({ decision: "delete", reason: "long enough" }).success).toBe(false);

    const a = await admin();
    const owner = await organizer();
    const e = await createEvent(owner.actor, eventInput());
    await expect(reviewEvent(a, e.id, { decision: "approve" })).rejects.toMatchObject({ status: 409 }); // not submitted yet
    await submitEventForReview(owner.actor, e.id);
    await expect(submitEventForReview(owner.actor, e.id)).rejects.toMatchObject({ status: 409 }); // already waiting
    await reviewEvent(a, e.id, { decision: "request_changes", reason: "Please add a real schedule." });
    expect(await db().event.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ reviewStatus: "CHANGES_REQUESTED", reviewNote: "Please add a real schedule.", reviewedById: a.id });
    await expect(reviewEvent(a, e.id, { decision: "approve" })).rejects.toMatchObject({ status: 409 }); // decided once
    await submitEventForReview(owner.actor, e.id); // resubmission after changes
    await reviewEvent(a, e.id, { decision: "reject", reason: "Out of scope for the platform." });
    expect((await getEventForReview(a, e.id)).history.map((h) => h.action)).toEqual(["event.review_rejected", "event.review_submitted", "event.review_changes_requested", "event.review_submitted"]);
    const row = await db().auditLog.findFirstOrThrow({ where: { entityId: e.id, action: "event.review_rejected" } });
    expect(row).toMatchObject({ actorId: a.id, after: { reviewStatus: "REJECTED", reason: "Out of scope for the platform." } });
  });

  it("the database refuses a rejection without a reason, whatever the application does", async () => {
    const owner = await organizer();
    const e = await createEvent(owner.actor, eventInput());
    await expect(db().event.update({ where: { id: e.id }, data: { reviewStatus: "REJECTED" } })).rejects.toThrow();
    await expect(db().event.update({ where: { id: e.id }, data: { reviewStatus: "CHANGES_REQUESTED", reviewNote: "  " } })).rejects.toThrow();
  });

  it("another organizer cannot submit someone else's event; a published event cannot be submitted", async () => {
    const owner = await organizer();
    const other = await organizer();
    const e = await createEvent(owner.actor, eventInput());
    await expect(submitEventForReview(other.actor, e.id)).rejects.toMatchObject({ status: 404 });
    await setEventStatus(owner.actor, e.id, "publish");
    await expect(submitEventForReview(owner.actor, e.id)).rejects.toMatchObject({ status: 409 });
  });

  it("publishing is unchanged by default, and gated on approval only when the setting is on (administrators are exempt)", async () => {
    const a = await admin();
    const owner = await organizer();
    const free = await createEvent(owner.actor, eventInput());
    await setEventStatus(owner.actor, free.id, "publish"); // setting off: as before
    await setApprovalRequired(a, true);
    const gated = await createEvent(owner.actor, eventInput());
    await expect(setEventStatus(owner.actor, gated.id, "publish")).rejects.toMatchObject({ status: 409, message: /administrator approval/ });
    await submitEventForReview(owner.actor, gated.id);
    await expect(setEventStatus(owner.actor, gated.id, "publish")).rejects.toMatchObject({ status: 409 }); // submitted is not approved
    await reviewEvent(a, gated.id, { decision: "approve" });
    await expect(setEventStatus(owner.actor, gated.id, "publish")).resolves.toMatchObject({ status: "PUBLISHED" });
    const byAdmin = await createEvent(owner.actor, eventInput());
    await expect(setEventStatus(a, byAdmin.id, "publish")).resolves.toMatchObject({ status: "PUBLISHED" });
    expect(await db().auditLog.count({ where: { action: "admin.setting_changed", entityId: "event_approval_required", actorId: a.id } })).toBe(1);
  });

  it("the list filters by status, searches and paginates", async () => {
    const a = await admin();
    const owner = await organizer();
    const e1 = await createEvent(owner.actor, eventInput({ title: "vt review alpha" }));
    const e2 = await createEvent(owner.actor, eventInput({ title: "vt review beta" }));
    await submitEventForReview(owner.actor, e1.id);
    await submitEventForReview(owner.actor, e2.id);
    await reviewEvent(a, e2.id, { decision: "approve" });
    const waiting = await listEventReviews(a, reviewQuerySchema.parse({ review: "SUBMITTED", q: "vt review" }));
    expect(waiting.items.map((i) => i.id)).toEqual([e1.id]);
    const all = await listEventReviews(a, reviewQuerySchema.parse({ q: "vt review", pageSize: "1", page: "2" }));
    expect(all.total).toBe(2);
    expect(all.items).toHaveLength(1);
  });
});

describe("announcements", () => {
  it("validates input, starts as a draft, can be scheduled, published, unpublished and deleted only as a draft; every change is audited", async () => {
    const a = await admin();
    expect(announcementSchema.safeParse({ title: "x", body: "b" }).success).toBe(false);
    expect(announcementSchema.safeParse({ title: "vt ok title", body: "" }).success).toBe(false);
    expect(announcementSchema.safeParse({ title: "vt ok title", body: "b", audience: "EVERYONE" }).success).toBe(false);
    const { id } = await createAnnouncement(a, announcementSchema.parse({ title: "vt hello", body: "<b>plain text</b>", audience: "ALL" }));
    expect((await getAnnouncementAdmin(a, id)).state).toBe("DRAFT");
    await updateAnnouncement(a, id, announcementSchema.parse({ title: "vt hello 2", body: "edited", audience: "PARTICIPANTS" }));
    const now = new Date();
    await publishAnnouncement(a, id, new Date(now.getTime() + 3_600_000), now);
    expect((await listAnnouncementsAdmin(a, { state: "SCHEDULED", page: 1, pageSize: 50 }, now)).items.some((i) => i.id === id)).toBe(true);
    await publishAnnouncement(a, id, undefined, now);
    expect((await getAnnouncementAdmin(a, id)).state).toBe("PUBLISHED");
    await expect(deleteAnnouncement(a, id)).rejects.toMatchObject({ status: 409 });
    await unpublishAnnouncement(a, id);
    await expect(unpublishAnnouncement(a, id)).rejects.toMatchObject({ status: 409 });
    await deleteAnnouncement(a, id);
    await expect(getAnnouncementAdmin(a, id)).rejects.toMatchObject({ status: 404 });
    const actions = (await db().auditLog.findMany({ where: { entityType: "announcement", entityId: id }, orderBy: { createdAt: "asc" } })).map((r) => r.action);
    expect(actions).toEqual(["announcement.created", "announcement.updated", "announcement.scheduled", "announcement.published", "announcement.unpublished", "announcement.deleted"]);
  });

  it("readers see only published announcements for their audience and their own events", async () => {
    const a = await admin();
    const owner = await organizer();
    const p = await participant();
    const stranger = await createUser();
    const e = await createEvent(owner.actor, eventInput());
    await setEventStatus(owner.actor, e.id, "publish");
    await db().registration.create({ data: { eventId: e.id, userId: p.u.id, status: "CONFIRMED" } });
    const mk = async (title: string, audience: "ALL" | "ORGANIZERS" | "PARTICIPANTS" | "JUDGES", eventId?: string, publish = true) => {
      const { id } = await createAnnouncement(a, announcementSchema.parse({ title: `vt ${title}`, body: "b", audience, eventId }));
      if (publish) await publishAnnouncement(a, id, undefined);
      return id;
    };
    await mk("everyone", "ALL");
    await mk("draft", "ALL", undefined, false);
    await mk("participants", "PARTICIPANTS");
    await mk("organizers", "ORGANIZERS");
    await mk("judges", "JUDGES");
    await mk("event only", "ALL", e.id);
    const future = await mk("future", "ALL", undefined, false);
    await publishAnnouncement(a, future, new Date(Date.now() + 86_400_000));
    const titles = async (u: { id: string }) => (await listVisibleAnnouncements(u, new Date(), 50)).map((x) => x.title).filter((t) => t.startsWith("vt ")).sort();
    expect(await titles(stranger)).toEqual(["vt everyone"]);
    expect(await titles(p.u)).toEqual(["vt event only", "vt everyone", "vt participants"]);
    expect(await titles(owner.u)).toEqual(["vt event only", "vt everyone", "vt organizers"]);
  });
});

describe("maintenance mode", () => {
  it("pauses public writes with 503 but keeps reads, sign-in and administration available (no lock-out)", async () => {
    const a = await admin();
    await setMaintenance(a, { enabled: true, message: "Back in ten minutes." });
    const refuse = (m: string, p: string) => assertNotInMaintenance(req(m, p));
    await expect(refuse("POST", "/api/v1/auth/register")).rejects.toMatchObject({ status: 503, code: "maintenance", message: "Back in ten minutes.", headers: { "Retry-After": "300" } });
    await expect(refuse("POST", "/api/v1/events/abc/registrations")).rejects.toMatchObject({ status: 503 });
    await expect(refuse("DELETE", "/api/v1/auth/forgot-password")).rejects.toMatchObject({ status: 503 });
    for (const [m, p] of [["GET", "/api/v1/events"], ["POST", "/api/v1/auth/login"], ["POST", "/api/v1/auth/logout"], ["POST", "/api/v1/auth/mfa/confirm"], ["PUT", "/api/v1/admin/maintenance"], ["POST", "/api/v1/admin/users/x/status"]]) {
      await expect(refuse(m, p), `${m} ${p}`).resolves.toBeUndefined();
    }
    await setMaintenance(a, { enabled: false });
    await expect(refuse("POST", "/api/v1/auth/register")).resolves.toBeUndefined();
  });

  it("validates the message, audits every change and records history", async () => {
    const a = await admin();
    expect(maintenanceSchema.safeParse({ enabled: true, message: "no" }).success).toBe(false);
    expect(maintenanceSchema.safeParse({ enabled: "yes" }).success).toBe(false);
    expect(maintenanceSchema.safeParse({ enabled: true, message: "x".repeat(301) }).success).toBe(false);
    await setMaintenance(a, { enabled: true, message: "Planned upgrade." });
    await setMaintenance(a, { enabled: false });
    const rows = await db().auditLog.findMany({ where: { action: "maintenance.mode_changed", actorId: a.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => (r.after as { enabled: boolean }).enabled)).toEqual([true, false]);
    const status = await getPlatformStatus(a);
    expect(status.history[0].by).toBe("Test Person");
    expect(status.maintenance.enabled).toBe(false);
  });

  it("the status view reports database, storage, email and scheduler without exposing any configuration value", async () => {
    const status = await getPlatformStatus(await admin());
    expect(status.database.up).toBe(true);
    expect(status.email).toHaveProperty("ready");
    expect(Object.keys(status.storage).sort()).toEqual(["configured", "driver", "failedDeletions", "pendingDeletions", "pendingUploads"]);
    const text = JSON.stringify(status);
    for (const secret of [process.env.AUTH_SECRET, process.env.DATABASE_URL, process.env.SMTP_PASSWORD, process.env.S3_SECRET_ACCESS_KEY, process.env.CRON_SECRET]) if (secret) expect(text).not.toContain(secret);
  });
});

describe("read models are real and private", () => {
  async function seed() {
    const owner = await organizer();
    const e = await db().event.create({
      data: { slug: `vt-adm-${crypto.randomUUID().slice(0, 8)}`, title: "vt admin data", category: "HACKATHON", summary: "s", description: "d", status: "PUBLISHED", createdById: owner.u.id, registrationMode: "TEAM", minTeamSize: 1, maxTeamSize: 3,
        startsAt: new Date(Date.now() + 5 * 864e5), endsAt: new Date(Date.now() + 6 * 864e5), registrationOpensAt: new Date(Date.now() - 864e5), registrationClosesAt: new Date(Date.now() + 864e5), submissionDeadline: new Date(Date.now() + 5.5 * 864e5) },
    });
    const lead = await createUser();
    const mate = await createUser();
    const judge = await createUser({ roles: ["PARTICIPANT", "JUDGE"] });
    const team = await db().team.create({ data: { eventId: e.id, name: "vt Rockets", leaderId: lead.id } });
    await db().teamMember.createMany({ data: [{ teamId: team.id, eventId: e.id, userId: lead.id, role: "LEADER" }, { teamId: team.id, eventId: e.id, userId: mate.id }] });
    await db().teamInvitation.create({ data: { teamId: team.id, inviterId: lead.id, inviteeEmail: "private.person@example.com", tokenHash: crypto.randomUUID() + crypto.randomUUID(), expiresAt: new Date(Date.now() + 864e5) } });
    const sub = await db().submission.create({ data: { eventId: e.id, ownerId: lead.id, teamId: team.id, title: "vt Rocket app", description: "d", status: "SUBMITTED", submittedAt: new Date(), currentVersion: 1 } });
    await db().submissionFile.create({ data: { submissionId: sub.id, storageKey: `submissions/${sub.id}/${crypto.randomUUID()}`, originalName: "deck.pdf", mimeType: "application/pdf", sizeBytes: 10, sha256: "a".repeat(64) } });
    const c1 = await db().judgingCriterion.create({ data: { eventId: e.id, name: "Idea", maxScore: 10, weight: 1 } });
    await db().judgeAssignment.create({ data: { eventId: e.id, judgeId: judge.id } });
    return { owner, e, lead, mate, judge, team, sub, c1 };
  }

  it("overview numbers equal the database", async () => {
    const a = await admin();
    const before = await getAdminOverview(a);
    const s = await seed();
    const after = await getAdminOverview(a);
    expect(after.events.published - before.events.published).toBe(1);
    expect(after.teams - before.teams).toBe(1);
    expect(after.submissions - before.submissions).toBe(1);
    expect(after.pendingJudging - before.pendingJudging).toBe(1);
    expect(after.users.total - before.users.total).toBe(4); // owner, lead, mate and judge (the admin existed before the first count)
    expect(after.users.total).toBe(await db().user.count());
    expect(after.users.verified + after.users.unverified).toBe(after.users.total);
    expect(after.users.active + after.users.suspended).toBe(after.users.total);
    expect(after.events.total).toBe(await db().event.count());
    expect(s.e.id).toBeTruthy();
  });

  it("teams: search by team, event and leader; detail shows names, masks invitation addresses, lists history", async () => {
    const a = await admin();
    const s = await seed();
    for (const q of ["vt Rockets", "vt admin data", (await db().user.findUniqueOrThrow({ where: { id: s.lead.id } })).fullName]) {
      expect((await listAdminTeams(a, teamsQuerySchema.parse({ q, eventId: s.e.id }))).items.some((t) => t.id === s.team.id), q).toBe(true);
    }
    const d = await getAdminTeam(a, s.team.id);
    expect(d.members).toHaveLength(2);
    expect(JSON.stringify(d)).not.toContain("private.person@example.com");
    expect(d.invitations[0].inviteeEmail).toBe(maskEmail("private.person@example.com"));
    expect(JSON.stringify(d.members)).not.toMatch(/@/); // no member emails
    expect(d.submission?.id).toBe(s.sub.id);
  });

  it("submissions: filters work and details never include storage keys", async () => {
    const a = await admin();
    const s = await seed();
    const hit = await listAdminSubmissions(a, submissionsQuerySchema.parse({ eventId: s.e.id, status: "SUBMITTED", q: "Rocket" }));
    expect(hit.items.map((i) => i.id)).toEqual([s.sub.id]);
    expect((await listAdminSubmissions(a, submissionsQuerySchema.parse({ eventId: s.e.id, status: "SCORED" }))).total).toBe(0);
    expect((await listAdminSubmissions(a, submissionsQuerySchema.parse({ eventId: s.e.id, from: "2000-01-01", to: "2000-01-02" }))).total).toBe(0);
    const d = await getAdminSubmission(a, s.sub.id);
    expect(d.files).toHaveLength(1);
    expect(JSON.stringify(d)).not.toMatch(/storageKey|submissions\/[0-9a-f-]{36}\/[0-9a-f-]{36}|sha256/);
    expect(d.judging.judges).toEqual([{ name: "Test Person", complete: false }]);
  });

  it("judging: progress counts a scorecard only when every criterion is finalized; incomplete judging is listed", async () => {
    const a = await admin();
    const s = await seed();
    let o = (await getJudgingOverview(a, judgingQuerySchema.parse({ q: "vt admin data" }))).items[0];
    expect(o).toMatchObject({ submissions: 1, expected: 1, completed: 0, percent: 0 });
    expect((await getJudgingEvent(a, s.e.id)).incomplete).toHaveLength(1);
    await db().score.create({ data: { submissionId: s.sub.id, judgeId: s.judge.id, criterionId: s.c1.id, score: 8, finalizedAt: new Date() } });
    o = (await getJudgingOverview(a, judgingQuerySchema.parse({ q: "vt admin data" }))).items[0];
    expect(o).toMatchObject({ completed: 1, percent: 100 });
    expect((await getJudgingEvent(a, s.e.id)).incomplete).toHaveLength(0);
    expect((await getJudgingOverview(a, judgingQuerySchema.parse({ q: "vt admin data", incomplete: "1" }))).items).toHaveLength(0);
  });

  it("results: ties are flagged and nothing in the view changes a score", async () => {
    const a = await admin();
    const s = await seed();
    const second = await db().submission.create({ data: { eventId: s.e.id, ownerId: s.mate.id, title: "vt second", description: "d", status: "SUBMITTED", submittedAt: new Date() } });
    await db().result.createMany({ data: [{ eventId: s.e.id, submissionId: s.sub.id, finalScore: 8.5, rank: 1 }, { eventId: s.e.id, submissionId: second.id, finalScore: 8.5, rank: 1 }] });
    const before = await db().result.findMany({ where: { eventId: s.e.id }, orderBy: { id: "asc" } });
    const r = await getAdminResults(a, s.e.id);
    expect(r.rows.map((x) => x.tied)).toEqual([true, true]);
    expect((await listAdminResults(a, resultsQuerySchema.parse({ published: "no", q: "vt admin data" }))).items[0]._count.results).toBe(2);
    expect(await db().result.findMany({ where: { eventId: s.e.id }, orderBy: { id: "asc" } })).toEqual(before);
  });

  it("certificates: search by code, recipient, event and team; status filter", async () => {
    const a = await admin();
    const s = await seed();
    const cert = await db().certificate.create({ data: { publicCode: "ST-AAAAA-BBBBB-CCCCC", eventId: s.e.id, userId: s.lead.id, type: "PARTICIPATION", recipientName: "Zed Quokka" } });
    const find = async (q: string, status?: "issued" | "revoked") => (await listAdminCertificates(a, certificatesQuerySchema.parse({ q, status }))).items.map((i) => i.id);
    for (const q of ["st-aaaaa", "quokka", "vt admin data", "vt Rockets"]) expect(await find(q), q).toContain(cert.id);
    expect(await find("quokka", "revoked")).toEqual([]);
    await db().certificate.update({ where: { id: cert.id }, data: { revokedAt: new Date(), revokedReason: "test" } });
    expect(await find("quokka", "revoked")).toEqual([cert.id]);
    expect(await find("quokka", "issued")).toEqual([]);
  });
});
