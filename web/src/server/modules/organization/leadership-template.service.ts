import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { notFound } from "@/server/http/errors";
import { assertAdmin } from "@/server/modules/admin/admin-management.service";
import { writeAudit } from "@/server/modules/audit/audit.service";
import type { Actor } from "@/server/modules/authz/permissions";
import {
  DEFAULT_LEADERSHIP_TEMPLATE, MEMBER_STYLE_PREFIX, TEMPLATE_KEY, leadershipTemplateSchema, memberStyleKey, memberStyleSchema, parseMemberStyle, parseTemplate,
  type LeadershipTemplate, type MemberStyle,
} from "@/lib/leadership/template";

/**
 * The Universal Matrix Leadership Template: one shared design for every board member, plus a small style per member (portrait position and
 * decorative text). Stored as JSON rows in the existing `site_settings` table, so there is no schema change. Reading is public (the design is
 * not private); every change is admin-only, validated and clamped by the shared schemas, and audited.
 */
export async function getLeadershipTemplate(): Promise<LeadershipTemplate> {
  const row = await getDb().siteSetting.findUnique({ where: { key: TEMPLATE_KEY } });
  return row ? parseTemplate(row.value) : DEFAULT_LEADERSHIP_TEMPLATE;
}

export async function saveLeadershipTemplate(actor: Actor, input: unknown): Promise<LeadershipTemplate> {
  assertAdmin(actor);
  const value = leadershipTemplateSchema.parse(input); // a ZodError becomes a 400 with the field messages
  await getDb().$transaction(async (tx) => {
    await tx.siteSetting.upsert({ where: { key: TEMPLATE_KEY }, create: { key: TEMPLATE_KEY, value: value as Prisma.InputJsonValue }, update: { value: value as Prisma.InputJsonValue } });
    await writeAudit({ actorId: actor.id, action: "admin.leadership_template_saved", entityType: "site_setting", entityId: TEMPLATE_KEY }, tx);
  });
  return value;
}

export async function resetLeadershipTemplate(actor: Actor): Promise<LeadershipTemplate> {
  assertAdmin(actor);
  await getDb().$transaction(async (tx) => {
    await tx.siteSetting.deleteMany({ where: { key: TEMPLATE_KEY } });
    await writeAudit({ actorId: actor.id, action: "admin.leadership_template_reset", entityType: "site_setting", entityId: TEMPLATE_KEY }, tx);
  });
  return DEFAULT_LEADERSHIP_TEMPLATE;
}

export async function getMemberStyle(memberId: string): Promise<MemberStyle> {
  const row = await getDb().siteSetting.findUnique({ where: { key: memberStyleKey(memberId) } });
  return parseMemberStyle(row?.value);
}

/** Styles for many members at once (the public pages). Members without a stored style are simply absent from the map. */
export async function getMemberStyles(memberIds: readonly string[]): Promise<Map<string, MemberStyle>> {
  const out = new Map<string, MemberStyle>();
  if (memberIds.length === 0) return out;
  const rows = await getDb().siteSetting.findMany({ where: { key: { in: memberIds.map(memberStyleKey) } } });
  for (const r of rows) out.set(r.key.slice(MEMBER_STYLE_PREFIX.length), parseMemberStyle(r.value));
  return out;
}

export async function saveMemberStyle(actor: Actor, memberId: string, input: unknown): Promise<MemberStyle> {
  assertAdmin(actor);
  const value = memberStyleSchema.parse(input);
  await getDb().$transaction(async (tx) => {
    if (!(await tx.orgMember.findUnique({ where: { id: memberId }, select: { id: true } }))) throw notFound("Member");
    await tx.siteSetting.upsert({ where: { key: memberStyleKey(memberId) }, create: { key: memberStyleKey(memberId), value: value as Prisma.InputJsonValue }, update: { value: value as Prisma.InputJsonValue } });
    await writeAudit({ actorId: actor.id, action: "admin.org_member_card_saved", entityType: "org_member", entityId: memberId }, tx);
  });
  return value;
}

/** Removes a member's stored style (used when the member is deleted). */
export async function deleteMemberStyle(memberId: string): Promise<void> {
  await getDb().siteSetting.deleteMany({ where: { key: memberStyleKey(memberId) } });
}
