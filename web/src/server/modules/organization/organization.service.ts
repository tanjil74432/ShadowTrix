import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { AppError, conflict, notFound } from "@/server/http/errors";
import { assertAdmin } from "@/server/modules/admin/admin-management.service";
import { stripNul } from "@/lib/sanitize";
import { writeAudit } from "@/server/modules/audit/audit.service";
import { revokeAllUserSessions } from "@/server/modules/auth/session.service";
import type { Actor } from "@/server/modules/authz/permissions";
import { slugify } from "@/server/modules/events/event-lifecycle";
import { normalizeEmail } from "@/server/security/tokens";
import { drainStorageDeletionsBestEffort } from "@/server/modules/maintenance/storage-deletion.service";
import { getStorage } from "@/server/storage";
import { validateUpload } from "@/server/storage/file-validation";
import type { z } from "zod";
import type { designationSchema, memberSchema, memberUpdateSchema, membershipSchema, membershipUpdateSchema, organizationSchema, organizationUpdateSchema, termSchema, termUpdateSchema, unitSchema } from "./organization.schema";

type Tx = Prisma.TransactionClient;
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

async function uniqueSlug(tx: Pick<Tx, "organization" | "orgMember">, kind: "organization" | "orgMember", base: string): Promise<string> {
  const root = slugify(base);
  for (let i = 0; i < 6; i++) {
    const slug = i === 0 ? root : `${root}-${randomUUID().slice(0, 4)}`;
    const taken = kind === "organization" ? await tx.organization.findUnique({ where: { slug }, select: { id: true } }) : await tx.orgMember.findUnique({ where: { slug }, select: { id: true } });
    if (!taken) return slug;
  }
  return `${root}-${randomUUID().slice(0, 8)}`;
}

// ───────────────────────────── organizations ─────────────────────────────

export async function listOrganizations(actor: Actor) {
  assertAdmin(actor);
  return getDb().organization.findMany({
    orderBy: [{ isOperator: "desc" }, { name: "asc" }],
    select: {
      id: true, slug: true, name: true, type: true, description: true, websiteUrl: true, isOperator: true, verifiedAt: true, verifiedBy: { select: { fullName: true } },
      _count: { select: { eventHosts: true } },
    },
  });
}

export async function getOrganization(actor: Actor, id: string) {
  assertAdmin(actor);
  const org = await getDb().organization.findUnique({
    where: { id },
    select: {
      id: true, slug: true, name: true, type: true, description: true, websiteUrl: true, isOperator: true, verifiedAt: true, verifiedBy: { select: { fullName: true } },
      eventHosts: { select: { role: true, event: { select: { id: true, title: true, status: true } } }, take: 100 },
      roles: { where: { role: "ORGANIZER" }, select: { user: { select: { id: true, fullName: true, email: true } } } },
    },
  });
  if (!org) throw notFound("Organization");
  return org;
}

export async function createOrganization(actor: Actor, input: z.infer<typeof organizationSchema>) {
  assertAdmin(actor);
  if (input.type === "PLATFORM_OPERATOR") throw conflict("The platform operator organization already exists and cannot be created again.");
  return getDb().$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { slug: await uniqueSlug(tx, "organization", input.name), name: input.name, type: input.type, description: input.description ?? null, websiteUrl: input.websiteUrl ?? null } });
    await writeAudit({ actorId: actor.id, action: "admin.organization_created", entityType: "organization", entityId: org.id, after: { name: org.name } }, tx);
    return org;
  });
}

export async function updateOrganization(actor: Actor, id: string, input: z.infer<typeof organizationUpdateSchema>) {
  assertAdmin(actor);
  return getDb().$transaction(async (tx) => {
    const org = await tx.organization.findUnique({ where: { id } });
    if (!org) throw notFound("Organization");
    if (input.type !== undefined && (org.isOperator ? input.type !== "PLATFORM_OPERATOR" : input.type === "PLATFORM_OPERATOR")) throw conflict("The type of the platform operator organization cannot be changed, and no other organization can take it.");
    await tx.organization.update({ where: { id }, data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.type !== undefined ? { type: input.type } : {}), ...(input.description !== undefined ? { description: input.description } : {}), ...(input.websiteUrl !== undefined ? { websiteUrl: input.websiteUrl } : {}) } });
    await writeAudit({ actorId: actor.id, action: "admin.organization_updated", entityType: "organization", entityId: id, after: { fields: Object.keys(input) } }, tx);
  });
}

export async function deleteOrganization(actor: Actor, id: string) {
  assertAdmin(actor);
  return getDb().$transaction(async (tx) => {
    const org = await tx.organization.findUnique({ where: { id }, include: { _count: { select: { eventHosts: true } } } });
    if (!org) throw notFound("Organization");
    if (org.isOperator) throw conflict("The platform operator organization cannot be deleted.");
    if (org._count.eventHosts > 0) throw conflict("This organization hosts events. Remove it from them first.");
    await tx.organization.delete({ where: { id } });
    await writeAudit({ actorId: actor.id, action: "admin.organization_deleted", entityType: "organization", entityId: id, before: { name: org.name } }, tx);
  });
}

/** Records (or clears) that an administrator checked the organization's identity. */
export async function setOrganizationVerified(actor: Actor, id: string, verified: boolean, now: Date = new Date()) {
  assertAdmin(actor);
  return getDb().$transaction(async (tx) => {
    const res = await tx.organization.updateMany({ where: { id }, data: verified ? { verifiedAt: now, verifiedById: actor.id } : { verifiedAt: null, verifiedById: null } });
    if (res.count !== 1) throw notFound("Organization");
    await writeAudit({ actorId: actor.id, action: verified ? "admin.organization_verified" : "admin.organization_unverified", entityType: "organization", entityId: id }, tx);
  });
}

/** An organization representative: an existing, confirmed account holding an ORGANIZER role scoped to this organization. */
export async function addRepresentative(actor: Actor, organizationId: string, rawEmail: string) {
  assertAdmin(actor);
  const email = normalizeEmail(rawEmail);
  return getDb().$transaction(async (tx) => {
    if (!(await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true } }))) throw notFound("Organization");
    const user = await tx.user.findUnique({ where: { email }, select: { id: true, status: true, emailVerifiedAt: true } });
    if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) throw new AppError(404, "user_not_found", "No active, confirmed account has that email address.");
    if (await tx.userRoleAssignment.findFirst({ where: { userId: user.id, role: "ORGANIZER", organizationId } })) return { created: false };
    await tx.userRoleAssignment.create({ data: { userId: user.id, role: "ORGANIZER", organizationId, grantedById: actor.id } });
    await revokeAllUserSessions(user.id, "role_changed", tx);
    await writeAudit({ actorId: actor.id, action: "admin.organization_representative_added", entityType: "organization", entityId: organizationId, after: { userId: user.id } }, tx);
    return { created: true };
  });
}

export async function removeRepresentative(actor: Actor, organizationId: string, userId: string) {
  assertAdmin(actor);
  return getDb().$transaction(async (tx) => {
    const res = await tx.userRoleAssignment.deleteMany({ where: { userId, role: "ORGANIZER", organizationId } });
    if (res.count !== 1) throw notFound("Representative");
    await revokeAllUserSessions(userId, "role_changed", tx);
    await writeAudit({ actorId: actor.id, action: "admin.organization_representative_removed", entityType: "organization", entityId: organizationId, after: { userId } }, tx);
  });
}

// ───────────────────────────── leadership: terms, units, designations ─────────────────────────────

export async function listLeadershipReference(actor: Actor) {
  assertAdmin(actor);
  const db = getDb();
  const [units, designations, terms] = await Promise.all([
    db.orgUnit.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }] }),
    db.designation.findMany({ orderBy: [{ rankOrder: "asc" }, { title: "asc" }] }),
    db.orgTerm.findMany({ orderBy: { startsOn: "desc" } }),
  ]);
  return { units, designations, terms };
}

export async function createUnit(actor: Actor, input: z.infer<typeof unitSchema>) {
  assertAdmin(actor);
  try {
    return await getDb().$transaction(async (tx) => {
      const u = await tx.orgUnit.create({ data: { slug: slugify(input.name), name: input.name, description: input.description ?? null, displayOrder: input.displayOrder } });
      await writeAudit({ actorId: actor.id, action: "admin.org_unit_created", entityType: "org_unit", entityId: u.id, after: { name: u.name } }, tx);
      return u;
    });
  } catch (e) {
    if (isUnique(e)) throw new AppError(409, "unit_exists", "A unit with this name already exists.");
    throw e;
  }
}

export async function createDesignation(actor: Actor, input: z.infer<typeof designationSchema>) {
  assertAdmin(actor);
  try {
    return await getDb().$transaction(async (tx) => {
      const d = await tx.designation.create({ data: { title: input.title, rankOrder: input.rankOrder } });
      await writeAudit({ actorId: actor.id, action: "admin.designation_created", entityType: "designation", entityId: d.id, after: { title: d.title } }, tx);
      return d;
    });
  } catch (e) {
    if (isUnique(e)) throw new AppError(409, "designation_exists", "A designation with this title already exists.");
    throw e;
  }
}

export async function createTerm(actor: Actor, input: z.infer<typeof termSchema>) {
  assertAdmin(actor);
  if (input.endsOn && input.endsOn < input.startsOn) throw new AppError(400, "invalid_term", "The term cannot end before it starts.");
  try {
    return await getDb().$transaction(async (tx) => {
      if (input.isCurrent) await tx.orgTerm.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      const t = await tx.orgTerm.create({ data: { label: input.label, startsOn: input.startsOn, endsOn: input.endsOn ?? null, isCurrent: input.isCurrent } });
      await writeAudit({ actorId: actor.id, action: "admin.org_term_created", entityType: "org_term", entityId: t.id, after: { label: t.label, current: t.isCurrent } }, tx);
      return t;
    });
  } catch (e) {
    if (isUnique(e)) throw new AppError(409, "term_exists", "A term with this label already exists.");
    throw e;
  }
}

export async function updateTerm(actor: Actor, id: string, input: z.infer<typeof termUpdateSchema>) {
  assertAdmin(actor);
  return getDb().$transaction(async (tx) => {
    const t = await tx.orgTerm.findUnique({ where: { id } });
    if (!t) throw notFound("Term");
    const startsOn = input.startsOn ?? t.startsOn;
    const endsOn = input.endsOn !== undefined ? input.endsOn : t.endsOn;
    if (endsOn && endsOn < startsOn) throw new AppError(400, "invalid_term", "The term cannot end before it starts.");
    if (input.isCurrent) await tx.orgTerm.updateMany({ where: { isCurrent: true, NOT: { id } }, data: { isCurrent: false } });
    await tx.orgTerm.update({ where: { id }, data: { ...(input.label !== undefined ? { label: input.label } : {}), startsOn, endsOn, ...(input.isCurrent !== undefined ? { isCurrent: input.isCurrent } : {}) } });
    await writeAudit({ actorId: actor.id, action: "admin.org_term_updated", entityType: "org_term", entityId: id, after: { fields: Object.keys(input) } }, tx);
  });
}

// ───────────────────────────── leadership: members ─────────────────────────────

const MEMBER_ADMIN = {
  id: true, slug: true, fullName: true, bio: true, department: true, responsibilities: true, linkedinUrl: true, githubUrl: true, portfolioUrl: true, email: true, emailPublic: true,
  skills: true, status: true, visibility: true, isPlaceholder: true, photoUrl: true, userId: true, updatedAt: true,
  memberships: { select: { id: true, displayOrder: true, isArchived: true, startedOn: true, endedOn: true, unit: { select: { id: true, name: true } }, designation: { select: { id: true, title: true } }, term: { select: { id: true, label: true } } }, orderBy: [{ isArchived: "asc" as const }, { displayOrder: "asc" as const }] },
} satisfies Prisma.OrgMemberSelect;

export async function listMembers(actor: Actor, opts: { q?: string; unitId?: string; status?: "ACTIVE" | "FORMER" }) {
  assertAdmin(actor);
  return getDb().orgMember.findMany({
    where: {
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.unitId ? { memberships: { some: { unitId: opts.unitId } } } : {}),
      ...(opts.q && stripNul(opts.q) ? { fullName: { contains: stripNul(opts.q), mode: "insensitive" } } : {}),
    },
    select: MEMBER_ADMIN, orderBy: [{ status: "asc" }, { fullName: "asc" }], take: 200,
  });
}

export async function getMember(actor: Actor, id: string) {
  assertAdmin(actor);
  const m = await getDb().orgMember.findUnique({ where: { id }, select: MEMBER_ADMIN });
  if (!m) throw notFound("Member");
  return m;
}

function assertPublishable(m: { visibility: string; isPlaceholder: boolean }) {
  if (m.visibility === "PUBLISHED" && m.isPlaceholder) {
    throw new AppError(409, "placeholder_not_publishable", "Confirm that the details are verified (turn off \"placeholder\") before publishing a member profile.");
  }
}

export async function createMember(actor: Actor, input: z.infer<typeof memberSchema>) {
  assertAdmin(actor);
  assertPublishable(input);
  return getDb().$transaction(async (tx) => {
    const m = await tx.orgMember.create({
      data: {
        slug: await uniqueSlug(tx, "orgMember", input.fullName), fullName: input.fullName, bio: input.bio ?? null, department: input.department ?? null, responsibilities: input.responsibilities ?? null,
        linkedinUrl: input.linkedinUrl ?? null, githubUrl: input.githubUrl ?? null, portfolioUrl: input.portfolioUrl ?? null, email: input.email ?? null, emailPublic: input.emailPublic,
        skills: input.skills, status: input.status, visibility: input.visibility, isPlaceholder: input.isPlaceholder,
      },
    });
    await writeAudit({ actorId: actor.id, action: "admin.org_member_created", entityType: "org_member", entityId: m.id, after: { name: m.fullName, visibility: m.visibility } }, tx);
    return m;
  });
}

export async function updateMember(actor: Actor, id: string, input: z.infer<typeof memberUpdateSchema>) {
  assertAdmin(actor);
  return getDb().$transaction(async (tx) => {
    const m = await tx.orgMember.findUnique({ where: { id } });
    if (!m) throw notFound("Member");
    const merged = { visibility: input.visibility ?? m.visibility, isPlaceholder: input.isPlaceholder ?? m.isPlaceholder };
    assertPublishable(merged);
    const data: Prisma.OrgMemberUpdateInput = {};
    for (const k of ["fullName", "bio", "department", "responsibilities", "linkedinUrl", "githubUrl", "portfolioUrl", "email", "emailPublic", "skills", "status", "visibility", "isPlaceholder"] as const) {
      if (input[k] !== undefined) (data as Record<string, unknown>)[k] = input[k];
    }
    await tx.orgMember.update({ where: { id }, data });
    await writeAudit({ actorId: actor.id, action: "admin.org_member_updated", entityType: "org_member", entityId: id, after: { fields: Object.keys(input) } }, tx);
  });
}

export async function deleteMember(actor: Actor, id: string) {
  assertAdmin(actor);
  const key = await getDb().$transaction(async (tx) => {
    const m = await tx.orgMember.findUnique({ where: { id } });
    if (!m) throw notFound("Member");
    await tx.orgMember.delete({ where: { id } });
    await writeAudit({ actorId: actor.id, action: "admin.org_member_deleted", entityType: "org_member", entityId: id, before: { name: m.fullName } }, tx);
    return m.photoKey;
  });
  if (key) await drainStorageDeletionsBestEffort([key]); // the database trigger queued it in the transaction above
}

// ───────────────────────────── leadership: memberships ─────────────────────────────

export async function addMembership(actor: Actor, memberId: string, input: z.infer<typeof membershipSchema>) {
  assertAdmin(actor);
  if (input.startedOn && input.endedOn && input.endedOn < input.startedOn) throw new AppError(400, "invalid_dates", "The end date cannot be before the start date.");
  try {
    return await getDb().$transaction(async (tx) => {
      if (!(await tx.orgMember.findUnique({ where: { id: memberId }, select: { id: true } }))) throw notFound("Member");
      const m = await tx.orgMembership.create({ data: { memberId, unitId: input.unitId, designationId: input.designationId, termId: input.termId ?? null, startedOn: input.startedOn ?? null, endedOn: input.endedOn ?? null, displayOrder: input.displayOrder } });
      await writeAudit({ actorId: actor.id, action: "admin.org_membership_added", entityType: "org_member", entityId: memberId, after: { membershipId: m.id, unitId: input.unitId, designationId: input.designationId } }, tx);
      return m;
    });
  } catch (e) {
    if (isUnique(e)) throw new AppError(409, "membership_exists", "This person already has that designation in that unit for that term.");
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") throw new AppError(400, "unknown_reference", "The unit, designation or term does not exist.");
    if (e instanceof Error && /org_memberships_dates_chk/.test(e.message)) throw new AppError(400, "invalid_dates", "The end date cannot be before the start date.");
    throw e;
  }
}

export async function updateMembership(actor: Actor, id: string, input: z.infer<typeof membershipUpdateSchema>, now: Date = new Date()) {
  assertAdmin(actor);
  return getDb().$transaction(async (tx) => {
    const m = await tx.orgMembership.findUnique({ where: { id } });
    if (!m) throw notFound("Membership");
    const data: Prisma.OrgMembershipUncheckedUpdateInput = {};
    for (const k of ["unitId", "designationId", "termId", "startedOn", "endedOn", "displayOrder", "isArchived"] as const) if (input[k] !== undefined) (data as Record<string, unknown>)[k] = input[k];
    // Archiving keeps the history: the person leaves the current listing and the end date is recorded.
    if (input.isArchived === true && m.endedOn === null && input.endedOn === undefined) data.endedOn = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const started = (data.startedOn as Date | null | undefined) ?? m.startedOn;
    const ended = (data.endedOn as Date | null | undefined) ?? m.endedOn;
    if (started && ended && ended < started) throw new AppError(400, "invalid_dates", "The end date cannot be before the start date.");
    await tx.orgMembership.update({ where: { id }, data });
    await writeAudit({ actorId: actor.id, action: input.isArchived ? "admin.org_membership_archived" : "admin.org_membership_updated", entityType: "org_member", entityId: m.memberId, after: { membershipId: id, fields: Object.keys(input) } }, tx);
  });
}

export async function deleteMembership(actor: Actor, id: string) {
  assertAdmin(actor);
  return getDb().$transaction(async (tx) => {
    const m = await tx.orgMembership.findUnique({ where: { id } });
    if (!m) throw notFound("Membership");
    await tx.orgMembership.delete({ where: { id } });
    await writeAudit({ actorId: actor.id, action: "admin.org_membership_removed", entityType: "org_member", entityId: m.memberId, after: { membershipId: id } }, tx);
  });
}

// ───────────────────────────── profile photos ─────────────────────────────

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** Photos are PNG or JPEG, up to 2 MB, validated by extension, declared type and magic bytes like every upload. */
export async function setMemberPhoto(actor: Actor, memberId: string, upload: { name: string; declaredMime: string; bytes: Uint8Array }) {
  assertAdmin(actor);
  const check = validateUpload(upload);
  if (!check.ok) throw new AppError(400, "invalid_file", check.reason);
  if (!["png", "jpg", "jpeg"].includes(check.extension)) throw new AppError(400, "invalid_file", "A profile photo must be a PNG or JPEG image.");
  if (upload.bytes.length > MAX_PHOTO_BYTES) throw new AppError(400, "invalid_file", "A profile photo can be at most 2 MB.");
  const storage = getStorage();
  const key = `org-members/${memberId}/${randomUUID()}`;
  const old = await getDb().$transaction(async (tx) => {
    const m = await tx.orgMember.findUnique({ where: { id: memberId }, select: { photoKey: true } });
    if (!m) throw notFound("Member");
    await storage.put(key, upload.bytes);
    try {
      await tx.orgMember.update({ where: { id: memberId }, data: { photoKey: key, photoUrl: `/api/v1/org-members/${memberId}/photo` } });
      await writeAudit({ actorId: actor.id, action: "admin.org_member_photo_set", entityType: "org_member", entityId: memberId }, tx);
    } catch (e) {
      await storage.remove(key);
      throw e;
    }
    return m.photoKey;
  });
  if (old) await drainStorageDeletionsBestEffort([old]); // queued by the trigger when the photo key changed
}

export async function removeMemberPhoto(actor: Actor, memberId: string) {
  assertAdmin(actor);
  const old = await getDb().$transaction(async (tx) => {
    const m = await tx.orgMember.findUnique({ where: { id: memberId }, select: { photoKey: true } });
    if (!m) throw notFound("Member");
    await tx.orgMember.update({ where: { id: memberId }, data: { photoKey: null, photoUrl: null } });
    await writeAudit({ actorId: actor.id, action: "admin.org_member_photo_removed", entityType: "org_member", entityId: memberId }, tx);
    return m.photoKey;
  });
  if (old) await drainStorageDeletionsBestEffort([old]);
}

/** A photo is public only for verified, published members. Administrators can always see it. */
export async function getMemberPhoto(actor: Actor | null, memberId: string) {
  const m = await getDb().orgMember.findUnique({ where: { id: memberId }, select: { photoKey: true, visibility: true, isPlaceholder: true } });
  if (!m?.photoKey) throw notFound("Photo");
  const isAdmin = !!actor && actor.roles.some((r) => r.role === "ADMIN" && !r.eventId && !r.organizationId);
  if (!isAdmin && (m.visibility !== "PUBLISHED" || m.isPlaceholder)) throw notFound("Photo");
  const stored = await getStorage().get(m.photoKey);
  if (!stored) throw notFound("Photo");
  const b = stored.bytes;
  const mime = b[0] === 0x89 ? "image/png" : "image/jpeg";
  return { bytes: stored.bytes, mime };
}

// ───────────────────────────── public team page ─────────────────────────────

/**
 * What the public "Our Team" page shows: ONLY members whose details an administrator marked verified (not placeholders) and
 * published. Current people are grouped by unit, ordered by designation seniority, then display order, then name; former
 * members appear in their own archive. Emails appear only when the member made them public. Nothing is invented: with no
 * verified members the result is empty.
 */
export async function getPublicTeam() {
  const db = getDb();
  const rows = await db.orgMembership.findMany({
    where: { member: { visibility: "PUBLISHED", isPlaceholder: false }, unit: { isActive: true } },
    select: {
      displayOrder: true, isArchived: true, startedOn: true, endedOn: true,
      unit: { select: { id: true, name: true, displayOrder: true } },
      designation: { select: { title: true, rankOrder: true } },
      term: { select: { label: true } },
      member: { select: { id: true, slug: true, fullName: true, bio: true, department: true, skills: true, status: true, photoKey: true, linkedinUrl: true, githubUrl: true, portfolioUrl: true, email: true, emailPublic: true } },
    },
  });
  const person = (r: (typeof rows)[number]) => ({
    id: r.member.id, name: r.member.fullName, designation: r.designation.title, rank: r.designation.rankOrder, order: r.displayOrder, term: r.term?.label ?? null,
    bio: r.member.bio, department: r.member.department, skills: r.member.skills, hasPhoto: !!r.member.photoKey,
    links: { linkedin: r.member.linkedinUrl, github: r.member.githubUrl, portfolio: r.member.portfolioUrl },
    email: r.member.emailPublic ? r.member.email : null, startedOn: r.startedOn, endedOn: r.endedOn,
  });
  const sort = (a: ReturnType<typeof person>, b: ReturnType<typeof person>) => a.rank - b.rank || a.order - b.order || a.name.localeCompare(b.name);
  const current = rows.filter((r) => !r.isArchived && r.member.status === "ACTIVE");
  const former = rows.filter((r) => r.isArchived || r.member.status === "FORMER");
  const units = new Map<string, { id: string; name: string; order: number; people: ReturnType<typeof person>[] }>();
  for (const r of current) {
    const u = units.get(r.unit.id) ?? { id: r.unit.id, name: r.unit.name, order: r.unit.displayOrder, people: [] };
    u.people.push(person(r));
    units.set(r.unit.id, u);
  }
  return {
    units: [...units.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)).map((u) => ({ ...u, people: u.people.sort(sort) })),
    former: former.map(person).sort(sort),
  };
}
