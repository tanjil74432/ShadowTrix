import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

/**
 * Integration tests: prove the database itself rejects invalid data.
 * Every test runs in a transaction that is always rolled back, leaving no rows behind.
 * Requires a migrated database (docker compose up -d db && npm run db:deploy).
 */
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
afterAll(() => db.$disconnect());

class Rollback extends Error {}
type Tx = Prisma.TransactionClient;

/** Runs fn in a transaction and always rolls back. Resolves if fn resolved; rejects with fn's error. */
async function rolledBack(fn: (tx: Tx) => Promise<void>) {
  try {
    await db.$transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

let n = 0;
const uniq = () => `t${Date.now()}${n++}`;
const user = (tx: Tx, email = `${uniq()}@example.test`) =>
  tx.user.create({ data: { email, passwordHash: "x", fullName: "Test User" } });

const hours = (h: number) => new Date(Date.UTC(2030, 0, 1) + h * 3600_000);
const eventData = (over: Partial<Prisma.EventCreateInput> = {}): Prisma.EventCreateInput => ({
  slug: uniq(),
  title: "Test Event",
  category: "HACKATHON",
  summary: "s",
  description: "d",
  startsAt: hours(100),
  endsAt: hours(148),
  registrationOpensAt: hours(0),
  registrationClosesAt: hours(90),
  ...over,
});

describe("database integrity", () => {
  it("rejects non-lowercase emails", async () => {
    await expect(rolledBack((tx) => user(tx, "Mixed@Example.test").then(() => {}))).rejects.toThrow(/users_email_lowercase_chk/);
  });

  it("rejects events that end before they start", async () => {
    await expect(
      rolledBack((tx) =>
        tx.event
          .create({ data: eventData({ startsAt: hours(100), endsAt: hours(50), registrationClosesAt: hours(40) }) })
          .then(() => {}),
      ),
    ).rejects.toThrow(/events_dates_chk/);
  });

  it("rejects registration closing after the event ends", async () => {
    await expect(
      rolledBack((tx) => tx.event.create({ data: eventData({ registrationClosesAt: hours(200) }) }).then(() => {})),
    ).rejects.toThrow(/events_registration_window_chk/);
  });

  it("requires team sizes for team events", async () => {
    await expect(
      rolledBack((tx) => tx.event.create({ data: eventData({ registrationMode: "TEAM" }) }).then(() => {})),
    ).rejects.toThrow(/events_team_size_chk/);
    await rolledBack((tx) =>
      tx.event.create({ data: eventData({ registrationMode: "TEAM", minTeamSize: 2, maxTeamSize: 4 }) }).then(() => {}),
    );
  });

  it("keeps the timeline ordered: submission -> judging -> results announcement", async () => {
    const make = (over: Partial<Prisma.EventCreateInput>) => (tx: Tx) =>
      tx.event.create({ data: eventData({ submissionDeadline: hours(140), ...over }) }).then(() => {});
    // valid full timeline
    await rolledBack(
      make({ judgingStartsAt: hours(150), judgingEndsAt: hours(170), resultsAnnouncementAt: hours(180) }),
    );
    // judging window reversed
    await expect(rolledBack(make({ judgingStartsAt: hours(170), judgingEndsAt: hours(150) }))).rejects.toThrow(
      /events_judging_window_chk/,
    );
    // judging starts before the submission deadline
    await expect(rolledBack(make({ judgingStartsAt: hours(130), judgingEndsAt: hours(170) }))).rejects.toThrow(
      /events_judging_after_submission_chk/,
    );
    // results announced before judging ends
    await expect(
      rolledBack(make({ judgingStartsAt: hours(150), judgingEndsAt: hours(170), resultsAnnouncementAt: hours(160) })),
    ).rejects.toThrow(/events_results_after_judging_chk/);
  });

  it("rejects duplicate registrations for the same user and event", async () => {
    await expect(
      rolledBack(async (tx) => {
        const u = await user(tx);
        const e = await tx.event.create({ data: eventData() });
        await tx.registration.create({ data: { eventId: e.id, userId: u.id } });
        await tx.registration.create({ data: { eventId: e.id, userId: u.id } });
      }),
    ).rejects.toThrow(/registrations_event_id_user_id_key/);
  });

  it("allows only one LEADER per team", async () => {
    await expect(
      rolledBack(async (tx) => {
        const a = await user(tx);
        const b = await user(tx);
        const e = await tx.event.create({
          data: eventData({ registrationMode: "TEAM", minTeamSize: 1, maxTeamSize: 4 }),
        });
        const t = await tx.team.create({ data: { eventId: e.id, name: "T", leaderId: a.id } });
        await tx.teamMember.create({ data: { teamId: t.id, eventId: e.id, userId: a.id, role: "LEADER" } });
        await tx.teamMember.create({ data: { teamId: t.id, eventId: e.id, userId: b.id, role: "LEADER" } });
      }),
    ).rejects.toThrow(/team_members_single_leader_idx/);
  });

  it("a person can be in only one team per event, and a membership must match its team's event", async () => {
    await expect(
      rolledBack(async (tx) => {
        const a = await user(tx);
        const b = await user(tx);
        const e = await tx.event.create({ data: eventData({ registrationMode: "TEAM", minTeamSize: 1, maxTeamSize: 4 }) });
        const t1 = await tx.team.create({ data: { eventId: e.id, name: "T1", leaderId: a.id } });
        const t2 = await tx.team.create({ data: { eventId: e.id, name: "T2", leaderId: b.id } });
        await tx.teamMember.create({ data: { teamId: t1.id, eventId: e.id, userId: a.id, role: "LEADER" } });
        await tx.teamMember.create({ data: { teamId: t2.id, eventId: e.id, userId: a.id, role: "MEMBER" } });
      }),
    ).rejects.toThrow(/team_members_event_id_user_id_key/);
    await expect(
      rolledBack(async (tx) => {
        const a = await user(tx);
        const e1 = await tx.event.create({ data: eventData({ registrationMode: "TEAM", minTeamSize: 1, maxTeamSize: 4 }) });
        const e2 = await tx.event.create({ data: eventData({ registrationMode: "TEAM", minTeamSize: 1, maxTeamSize: 4 }) });
        const t = await tx.team.create({ data: { eventId: e1.id, name: "T", leaderId: a.id } });
        await tx.teamMember.create({ data: { teamId: t.id, eventId: e2.id, userId: a.id, role: "LEADER" } });
      }),
    ).rejects.toThrow(/team_members_team_id_event_id_fkey/);
  });

  it("the team size limit is enforced by the database", async () => {
    await expect(
      rolledBack(async (tx) => {
        const [a, b, c] = [await user(tx), await user(tx), await user(tx)];
        const e = await tx.event.create({ data: eventData({ registrationMode: "TEAM", minTeamSize: 1, maxTeamSize: 2 }) });
        const t = await tx.team.create({ data: { eventId: e.id, name: "T", leaderId: a.id } });
        await tx.teamMember.create({ data: { teamId: t.id, eventId: e.id, userId: a.id, role: "LEADER" } });
        await tx.teamMember.create({ data: { teamId: t.id, eventId: e.id, userId: b.id, role: "MEMBER" } });
        await tx.teamMember.create({ data: { teamId: t.id, eventId: e.id, userId: c.id, role: "MEMBER" } });
      }),
    ).rejects.toThrow(/team is full/);
  });

  it("rejects a drafted submission that claims a submission time, and a submitted one without", async () => {
    await expect(
      rolledBack(async (tx) => {
        const a = await user(tx);
        const e = await tx.event.create({ data: eventData() });
        await tx.submission.create({ data: { eventId: e.id, ownerId: a.id, title: "t", description: "d", status: "DRAFT", submittedAt: new Date() } });
      }),
    ).rejects.toThrow(/submissions_submitted_at_chk/);
    await expect(
      rolledBack(async (tx) => {
        const a = await user(tx);
        const e = await tx.event.create({ data: eventData() });
        await tx.submission.create({ data: { eventId: e.id, ownerId: a.id, title: "t", description: "d", status: "SUBMITTED" } });
      }),
    ).rejects.toThrow(/submissions_submitted_at_chk/);
  });

  it("a certificate is revoked exactly when it has a revocation reason", async () => {
    await expect(
      rolledBack(async (tx) => {
        const a = await user(tx);
        const e = await tx.event.create({ data: eventData() });
        await tx.certificate.create({ data: { publicCode: "X-1", eventId: e.id, userId: a.id, type: "PARTICIPATION", recipientName: "A", revokedAt: new Date() } });
      }),
    ).rejects.toThrow(/certificates_revoked_chk/);
  });

  it("rejects duplicate global role grants (NULL-scope uniqueness)", async () => {
    await expect(
      rolledBack(async (tx) => {
        const u = await user(tx);
        await tx.userRoleAssignment.create({ data: { userId: u.id, role: "JUDGE" } });
        await tx.userRoleAssignment.create({ data: { userId: u.id, role: "JUDGE" } });
      }),
    ).rejects.toThrow(/user_roles_global_idx/);
  });

  it("allows a single platform operator organization only", async () => {
    await expect(
      rolledBack(async (tx) => {
        await tx.organization.create({ data: { slug: uniq(), name: "A", isOperator: true } });
        await tx.organization.create({ data: { slug: uniq(), name: "B", isOperator: true } });
      }),
    ).rejects.toThrow(/organizations_single_operator_idx/);
  });

  it("rejects scores above the criterion maximum but accepts valid ones", async () => {
    const setup = async (tx: Tx) => {
      const owner = await user(tx);
      const judge = await user(tx);
      const e = await tx.event.create({ data: eventData() });
      const s = await tx.submission.create({
        data: { eventId: e.id, ownerId: owner.id, title: "P", description: "d" },
      });
      const c = await tx.judgingCriterion.create({ data: { eventId: e.id, name: "Impact", maxScore: 10 } });
      return { judge, s, c };
    };
    await expect(
      rolledBack(async (tx) => {
        const { judge, s, c } = await setup(tx);
        await tx.score.create({ data: { submissionId: s.id, judgeId: judge.id, criterionId: c.id, score: 10.5 } });
      }),
    ).rejects.toThrow(/exceeds criterion max/);
    await rolledBack(async (tx) => {
      const { judge, s, c } = await setup(tx);
      await tx.score.create({ data: { submissionId: s.id, judgeId: judge.id, criterionId: c.id, score: 9.5 } });
    });
  });

  it("enforces unique certificate per event, user and type", async () => {
    await expect(
      rolledBack(async (tx) => {
        const u = await user(tx);
        const e = await tx.event.create({ data: eventData() });
        const base = { eventId: e.id, userId: u.id, type: "PARTICIPATION" as const, recipientName: "Test User" };
        await tx.certificate.create({ data: { ...base, publicCode: uniq() } });
        await tx.certificate.create({ data: { ...base, publicCode: uniq() } });
      }),
    ).rejects.toThrow(/certificates_event_id_user_id_type_key/);
  });

  it("keeps leadership history: a member may hold different designations across terms", async () => {
    await rolledBack(async (tx) => {
      const m = await tx.orgMember.create({ data: { slug: uniq(), fullName: "Placeholder Member" } });
      const unit = await tx.orgUnit.create({ data: { slug: uniq(), name: "U" } });
      const d1 = await tx.designation.create({ data: { title: uniq() } });
      const d2 = await tx.designation.create({ data: { title: uniq() } });
      const t1 = await tx.orgTerm.create({
        data: { label: uniq(), startsOn: new Date("2030-01-01"), endsOn: new Date("2030-12-31") },
      });
      const t2 = await tx.orgTerm.create({ data: { label: uniq(), startsOn: new Date("2031-01-01") } });
      await tx.orgMembership.create({
        data: { memberId: m.id, unitId: unit.id, designationId: d1.id, termId: t1.id, isArchived: true },
      });
      await tx.orgMembership.create({ data: { memberId: m.id, unitId: unit.id, designationId: d2.id, termId: t2.id } });
      expect(await tx.orgMembership.count({ where: { memberId: m.id } })).toBe(2);
    });
  });

  it("defaults org members to placeholder, draft, email private", async () => {
    await rolledBack(async (tx) => {
      const m = await tx.orgMember.create({ data: { slug: uniq(), fullName: "X", email: "x@example.test" } });
      expect(m.isPlaceholder).toBe(true);
      expect(m.visibility).toBe("DRAFT");
      expect(m.emailPublic).toBe(false);
    });
  });
});

describe("authentication tables", () => {
  const tokenData = (userId: string, over: Partial<Prisma.AuthTokenUncheckedCreateInput> = {}): Prisma.AuthTokenUncheckedCreateInput => ({
    userId,
    type: "EMAIL_VERIFY",
    tokenHash: uniq(),
    createdAt: hours(0),
    expiresAt: hours(1),
    ...over,
  });

  it("rejects sessions that expire before they are created", async () => {
    await expect(
      rolledBack(async (tx) => {
        const u = await user(tx);
        await tx.session.create({ data: { userId: u.id, tokenHash: uniq(), createdAt: hours(5), expiresAt: hours(1) } });
      }),
    ).rejects.toThrow(/sessions_expiry_chk/);
  });

  it("stores each session token hash once", async () => {
    await expect(
      rolledBack(async (tx) => {
        const u = await user(tx);
        const hash = uniq();
        const expiresAt = new Date(Date.now() + 3_600_000);
        await tx.session.create({ data: { userId: u.id, tokenHash: hash, expiresAt } });
        await tx.session.create({ data: { userId: u.id, tokenHash: hash, expiresAt } });
      }),
    ).rejects.toThrow(/sessions_token_hash_key/);
  });

  it("deletes a user's sessions and tokens together with the user", async () => {
    await rolledBack(async (tx) => {
      const u = await user(tx);
      await tx.session.create({ data: { userId: u.id, tokenHash: uniq(), expiresAt: new Date(Date.now() + 3_600_000) } });
      await tx.authToken.create({ data: { ...tokenData(u.id), expiresAt: new Date(Date.now() + 3_600_000), createdAt: new Date() } });
      await tx.user.delete({ where: { id: u.id } });
      expect(await tx.session.count({ where: { userId: u.id } })).toBe(0);
      expect(await tx.authToken.count({ where: { userId: u.id } })).toBe(0);
    });
  });

  it("rejects tokens that expire before they are created and negative rate-limit counts", async () => {
    await expect(
      rolledBack(async (tx) => {
        const u = await user(tx);
        await tx.authToken.create({ data: tokenData(u.id, { createdAt: hours(5), expiresAt: hours(1) }) });
      }),
    ).rejects.toThrow(/auth_tokens_expiry_chk/);
    await expect(
      rolledBack(async (tx) => {
        await tx.rateLimit.create({ data: { key: uniq(), windowStart: new Date(), count: -1 } });
      }),
    ).rejects.toThrow(/rate_limits_count_chk/);
  });

  it("allows only one live verification token and one live reset token per user, but any number of used ones", async () => {
    await expect(
      rolledBack(async (tx) => {
        const u = await user(tx);
        await tx.authToken.create({ data: tokenData(u.id) });
        await tx.authToken.create({ data: tokenData(u.id) });
      }),
    ).rejects.toThrow(/auth_tokens_one_live_per_type_idx/);

    await rolledBack(async (tx) => {
      const u = await user(tx);
      await tx.authToken.create({ data: tokenData(u.id, { usedAt: hours(0) }) });
      await tx.authToken.create({ data: tokenData(u.id, { usedAt: hours(0) }) });
      await tx.authToken.create({ data: tokenData(u.id) }); // one live EMAIL_VERIFY
      await tx.authToken.create({ data: tokenData(u.id, { type: "PASSWORD_RESET" }) }); // one live PASSWORD_RESET
      expect(await tx.authToken.count({ where: { userId: u.id } })).toBe(4);
    });
  });
});
