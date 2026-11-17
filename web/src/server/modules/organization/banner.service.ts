import "server-only";
import { getDb } from "@/server/db/client";
import { notFound } from "@/server/http/errors";
import { assertAdmin } from "@/server/modules/admin/admin-management.service";
import type { Actor } from "@/server/modules/authz/permissions";
import { eligibleTemplates } from "@/lib/banner/eligibility";
import type { TemplateId } from "@/lib/banner/templates";

/**
 * Data for the personal banner creator. The banner is rendered in the browser; this module only decides which
 * designations a person may put on it. A designation is offered only when it comes from a current, non-archived position of a
 * verified (non-placeholder) active organization member. Nothing here writes data or grants any permission.
 */
export interface BannerSubject {
  memberId: string | null;
  fullName: string;
  designations: { id: string; label: string }[];
  /** Templates this person may be offered, from real records (see lib/banner/eligibility.ts). Participant is always present. */
  templates: TemplateId[];
  /** Events this person is genuinely linked to (confirmed registration, team, organizer, judge); the banner can show one of these only. */
  events: { id: string; title: string }[];
}

const SELECT = {
  id: true, fullName: true, isPlaceholder: true, status: true, userId: true,
  memberships: {
    where: { isArchived: false },
    orderBy: [{ designation: { rankOrder: "asc" as const } }, { displayOrder: "asc" as const }],
    select: { id: true, designation: { select: { title: true } }, term: { select: { label: true } } },
  },
};

type MemberRow = { id: string; fullName: string; isPlaceholder: boolean; status: string; userId: string | null; memberships: { id: string; designation: { title: string }; term: { label: string } | null }[] };

/** Facts and events for one user account (null when a member has no linked account: then only the participant template applies). */
async function linkedRecords(userId: string | null) {
  if (!userId) return { roles: [] as string[], organizes: false, judges: false, onTeam: false, events: [] as { id: string; title: string; startsAt: Date }[] };
  const db = getDb();
  const pick = { id: true, title: true, startsAt: true } as const;
  const [roles, org, judge, team, reg] = await Promise.all([
    db.userRoleAssignment.findMany({ where: { userId }, select: { role: true } }),
    db.eventOrganizer.findMany({ where: { userId, event: { status: { in: ["DRAFT", "PUBLISHED"] } } }, select: { event: { select: pick } }, take: 30 }),
    db.judgeAssignment.findMany({ where: { judgeId: userId, event: { status: "PUBLISHED" } }, select: { event: { select: pick } }, take: 30 }),
    db.teamMember.findMany({ where: { userId, team: { event: { status: "PUBLISHED" } } }, select: { team: { select: { event: { select: pick } } } }, take: 30 }),
    db.registration.findMany({ where: { userId, status: "CONFIRMED", event: { status: "PUBLISHED" } }, select: { event: { select: pick } }, take: 30 }),
  ]);
  const events = new Map<string, { id: string; title: string; startsAt: Date }>();
  for (const e of [...org.map((r) => r.event), ...judge.map((r) => r.event), ...team.map((r) => r.team.event), ...reg.map((r) => r.event)]) events.set(e.id, e);
  return {
    roles: roles.map((r) => r.role as string),
    organizes: org.length > 0,
    judges: judge.length > 0,
    onTeam: team.length > 0,
    events: [...events.values()].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime()).slice(0, 40),
  };
}

async function toSubject(m: MemberRow): Promise<BannerSubject> {
  const approved = !m.isPlaceholder && m.status === "ACTIVE";
  const designations = approved ? m.memberships.map((x) => ({ id: x.id, label: x.designation.title })) : [];
  const rec = await linkedRecords(m.userId);
  return {
    memberId: m.id,
    fullName: m.fullName,
    designations,
    templates: eligibleTemplates({ designations: designations.map((d) => d.label), roles: rec.roles, organizesAnEvent: rec.organizes, judgesAnEvent: rec.judges, isVerifiedMember: approved && m.memberships.length > 0, isOnATeam: rec.onTeam }),
    events: rec.events.map(({ id, title }) => ({ id, title })),
  };
}

/** The signed-in user's own banner data. Members without a verified position get a name and no designation choices. */
export async function getOwnBannerSubject(user: { id: string; fullName: string }): Promise<BannerSubject> {
  const m = await getDb().orgMember.findUnique({ where: { userId: user.id }, select: SELECT });
  if (m) return { ...(await toSubject({ ...m, userId: user.id })), fullName: m.fullName || user.fullName };
  const rec = await linkedRecords(user.id);
  return {
    memberId: null,
    fullName: user.fullName,
    designations: [],
    templates: eligibleTemplates({ designations: [], roles: rec.roles, organizesAnEvent: rec.organizes, judgesAnEvent: rec.judges, isVerifiedMember: false, isOnATeam: rec.onTeam }),
    events: rec.events.map(({ id, title }) => ({ id, title })),
  };
}

/** Administrators: verified, active organization members that a banner can be generated for. */
export async function listBannerMembers(actor: Actor) {
  assertAdmin(actor);
  return getDb().orgMember.findMany({
    where: { isPlaceholder: false, status: "ACTIVE" },
    select: { id: true, fullName: true, memberships: { where: { isArchived: false }, select: { designation: { select: { title: true } } } } },
    orderBy: { fullName: "asc" },
    take: 300,
  });
}

export async function getBannerMember(actor: Actor, id: string): Promise<BannerSubject> {
  assertAdmin(actor);
  const m = await getDb().orgMember.findFirst({ where: { id, isPlaceholder: false, status: "ACTIVE" }, select: SELECT });
  if (!m) throw notFound("Verified member not found");
  return toSubject(m);
}
