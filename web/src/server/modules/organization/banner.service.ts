import "server-only";
import { getDb } from "@/server/db/client";
import { notFound } from "@/server/http/errors";
import { assertAdmin } from "@/server/modules/admin/admin-management.service";
import type { Actor } from "@/server/modules/authz/permissions";

/**
 * Data for the personal banner creator. The banner is rendered in the browser; this module only decides which
 * designations a person may put on it. A designation is offered only when it comes from a current, non-archived position of a
 * verified (non-placeholder) active organization member. Nothing here writes data or grants any permission.
 */
export interface BannerSubject {
  memberId: string | null;
  fullName: string;
  designations: { id: string; label: string }[];
}

const SELECT = {
  id: true, fullName: true, isPlaceholder: true, status: true,
  memberships: {
    where: { isArchived: false },
    orderBy: [{ designation: { rankOrder: "asc" as const } }, { displayOrder: "asc" as const }],
    select: { id: true, designation: { select: { title: true } }, term: { select: { label: true } } },
  },
};

function toSubject(m: { id: string; fullName: string; isPlaceholder: boolean; status: string; memberships: { id: string; designation: { title: string }; term: { label: string } | null }[] }): BannerSubject {
  const approved = !m.isPlaceholder && m.status === "ACTIVE";
  return {
    memberId: m.id,
    fullName: m.fullName,
    designations: approved ? m.memberships.map((x) => ({ id: x.id, label: x.designation.title })) : [],
  };
}

/** The signed-in user's own banner data. Members without a verified position get a name and no designation choices. */
export async function getOwnBannerSubject(user: { id: string; fullName: string }): Promise<BannerSubject> {
  const m = await getDb().orgMember.findUnique({ where: { userId: user.id }, select: SELECT });
  return m ? { ...toSubject(m), fullName: m.fullName || user.fullName } : { memberId: null, fullName: user.fullName, designations: [] };
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
