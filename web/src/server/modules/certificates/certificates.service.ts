import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { CertificateType, Prisma } from "@/generated/prisma/client";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { AppError, conflict, notFound } from "@/server/http/errors";
import { writeAudit } from "@/server/modules/audit/audit.service";
import { canManageEvent, type Actor } from "@/server/modules/authz/permissions";
import { loadManagedEvent } from "@/server/modules/events/events.service";
import { fillTemplate, renderCertificatePdf, unknownPlaceholders } from "./certificate-pdf";

type Tx = Prisma.TransactionClient;

// ───────────────────────────── templates ─────────────────────────────

const text = (max: number) => z.string().trim().max(max).refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/.test(v), "Contains characters that are not allowed.");
export const templateSchema = z.object({
  heading: text(80).min(3, "The heading must be at least 3 characters."),
  body: text(600).min(10, "The text must be at least 10 characters.").refine((b) => unknownPlaceholders(b).length === 0, "Only {{name}}, {{event}}, {{team}}, {{project}} and {{rank}} can be used in the text."),
  signatoryName: z.union([text(80).min(1), z.literal("").transform(() => null), z.null()]).optional(),
  signatoryTitle: z.union([text(80).min(1), z.literal("").transform(() => null), z.null()]).optional(),
});
export type TemplateInput = z.infer<typeof templateSchema>;

export const DEFAULT_TEMPLATES: Record<CertificateType, { heading: string; body: string }> = {
  PARTICIPATION: { heading: "Certificate of Participation", body: "This certificate confirms that {{name}} took part in the event and submitted a project." },
  FINALIST: { heading: "Certificate of Distinction", body: "{{name}} reached the finals of the event, ranked {{rank}}, with the project {{project}}." },
  WINNER: { heading: "Certificate of Achievement", body: "{{name}} won the event, ranked {{rank}}, with the project {{project}}." },
};

export async function getTemplate(actor: Actor, eventId: string, type: CertificateType) {
  await loadManagedEvent(actor, eventId);
  const t = await getDb().certificateTemplate.findUnique({ where: { eventId_type: { eventId, type } } });
  return t ? { heading: t.heading, body: t.body, signatoryName: t.signatoryName, signatoryTitle: t.signatoryTitle, isDefault: false } : { ...DEFAULT_TEMPLATES[type], signatoryName: null, signatoryTitle: null, isDefault: true };
}

export async function saveTemplate(actor: Actor, eventId: string, type: CertificateType, input: TemplateInput) {
  return getDb().$transaction(async (tx) => {
    await loadManagedEvent(actor, eventId, tx);
    const data = { heading: input.heading, body: input.body, signatoryName: input.signatoryName ?? null, signatoryTitle: input.signatoryTitle ?? null };
    await tx.certificateTemplate.upsert({ where: { eventId_type: { eventId, type } }, create: { eventId, type, ...data }, update: data });
    await writeAudit({ actorId: actor.id, action: "certificate.template_saved", entityType: "event", entityId: eventId, after: { type } }, tx);
  });
}

// ───────────────────────────── issuing ─────────────────────────────

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
/** `ST-XXXXX-XXXXX-XXXXX`: 15 random characters (75 bits), unguessable, easy to read aloud. */
export function newPublicCode(): string {
  const raw = Array.from(randomBytes(15), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return `ST-${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10)}`;
}
export const normalizeCode = (c: string) => c.trim().toUpperCase();
export const isCodeShape = (c: string) => /^ST-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(c);

const typeForAward = (award: string): CertificateType => (award === "WINNER" ? "WINNER" : award === "RUNNER_UP" || award === "FINALIST" ? "FINALIST" : "PARTICIPATION");

/**
 * Issues certificates from PUBLISHED, complete results only. One certificate per person per event, of the highest type
 * their result earned (winner, finalist, or participation for everyone else who submitted). Team results go to every
 * confirmed member of the team. Disqualified submissions earn none. Re-running skips people who already have one, so it is
 * safe to repeat; a revoked certificate is never silently replaced.
 */
export async function issueCertificates(actor: Actor, eventId: string, now: Date = new Date()) {
  return getDb().$transaction(async (tx) => {
    const event = await loadManagedEvent(actor, eventId, tx);
    if (!event.resultsPublishedAt) throw new AppError(409, "results_not_published", "Certificates can only be issued after the results are published.");
    const results = await tx.result.findMany({
      where: { eventId, publishedAt: { not: null }, submission: { status: { not: "DISQUALIFIED" } } },
      include: { submission: { select: { id: true, ownerId: true, teamId: true } } },
    });
    if (results.length === 0) throw new AppError(409, "no_results", "There are no published results to issue certificates for.");
    const have = new Set((await tx.certificate.findMany({ where: { eventId }, select: { userId: true } })).map((c) => c.userId));

    const targets = new Map<string, CertificateType>();
    for (const r of results) {
      const type = typeForAward(r.award);
      let userIds: string[];
      if (r.submission.teamId) {
        userIds = (await tx.registration.findMany({ where: { eventId, teamId: r.submission.teamId, status: "CONFIRMED" }, select: { userId: true } })).map((x) => x.userId);
      } else {
        userIds = [r.submission.ownerId];
      }
      for (const u of userIds) if (!have.has(u) && !targets.has(u)) targets.set(u, type);
    }
    const users = await tx.user.findMany({ where: { id: { in: [...targets.keys()] } }, select: { id: true, fullName: true } });
    let issued = 0;
    for (const u of users) {
      for (let attempt = 0; ; attempt++) {
        try {
          await tx.$executeRaw`SAVEPOINT cert_code`;
          await tx.certificate.create({ data: { publicCode: newPublicCode(), eventId, userId: u.id, type: targets.get(u.id)!, recipientName: u.fullName, issuedAt: now, issuedById: actor.id } });
          await tx.$executeRaw`RELEASE SAVEPOINT cert_code`;
          issued++;
          break;
        } catch (e) {
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT cert_code`;
          if ((e as { code?: string }).code !== "P2002" || attempt > 3) throw e; // a code collision is astronomically unlikely; retry a few times
        }
      }
    }
    await writeAudit({ actorId: actor.id, action: "certificates.issued", entityType: "event", entityId: eventId, after: { issued, skipped: results.length - issued } }, tx);
    return { issued, alreadyHad: have.size };
  });
}

export async function revokeCertificate(actor: Actor, certificateId: string, reason: string, now: Date = new Date()) {
  return getDb().$transaction(async (tx) => {
    const cert = await tx.certificate.findUnique({ where: { id: certificateId }, include: { event: { select: { id: true, organizers: { select: { userId: true } } } } } });
    if (!cert || !canManageEvent(actor, cert.eventId, cert.event.organizers.map((o) => o.userId))) throw notFound("Certificate");
    if (cert.revokedAt) throw conflict("This certificate is already revoked.");
    await tx.certificate.update({ where: { id: certificateId }, data: { revokedAt: now, revokedReason: reason.slice(0, 500) } });
    await writeAudit({ actorId: actor.id, action: "certificate.revoked", entityType: "certificate", entityId: certificateId, after: { reason: reason.slice(0, 500) } }, tx);
  });
}

// ───────────────────────────── reading ─────────────────────────────

export async function listMyCertificates(userId: string) {
  return getDb().certificate.findMany({
    where: { userId },
    orderBy: { issuedAt: "desc" },
    take: 100,
    select: { id: true, publicCode: true, type: true, issuedAt: true, revokedAt: true, event: { select: { title: true, slug: true } } },
  });
}

/** Issuance history for organizers: who received what, when, by whom, and whether it was revoked. */
export async function listEventCertificates(actor: Actor, eventId: string) {
  await loadManagedEvent(actor, eventId);
  return getDb().certificate.findMany({
    where: { eventId },
    orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
    select: { id: true, publicCode: true, type: true, recipientName: true, issuedAt: true, revokedAt: true, revokedReason: true, issuedBy: { select: { fullName: true } } },
  });
}

/**
 * Public verification: anyone with the code can confirm a certificate is genuine, who it was issued to, for which event and
 * whether it was revoked. No email, no result details. Unknown and malformed codes get the same answer.
 */
export async function verifyCertificate(rawCode: string) {
  const code = normalizeCode(rawCode);
  if (!isCodeShape(code)) return { status: "NOT_FOUND" as const };
  const c = await getDb().certificate.findUnique({ where: { publicCode: code }, select: { type: true, recipientName: true, issuedAt: true, revokedAt: true, event: { select: { title: true } } } });
  if (!c) return { status: "NOT_FOUND" as const };
  return { status: c.revokedAt ? ("REVOKED" as const) : ("VALID" as const), type: c.type, recipientName: c.recipientName, eventTitle: c.event.title, issuedAt: c.issuedAt, revokedAt: c.revokedAt };
}

/** The certificate PDF. Its recipient can download a valid one; organizers of the event can download any (revoked ones are marked). */
export async function getCertificatePdf(actor: Actor, certificateId: string) {
  const db = getDb();
  const c = await db.certificate.findUnique({
    where: { id: certificateId },
    include: { event: { select: { id: true, title: true, organizers: { select: { userId: true } } } } },
  });
  if (!c) throw notFound("Certificate");
  const manages = canManageEvent(actor, c.eventId, c.event.organizers.map((o) => o.userId));
  if (c.userId !== actor.id && !manages) throw notFound("Certificate");
  if (c.revokedAt && !manages) throw new AppError(410, "certificate_revoked", "This certificate was revoked.");

  const template = await db.certificateTemplate.findUnique({ where: { eventId_type: { eventId: c.eventId, type: c.type } } });
  const t = template ?? { ...DEFAULT_TEMPLATES[c.type], signatoryName: null, signatoryTitle: null };
  const result = await loadResultFacts(db, c.eventId, c.userId);
  const body = fillTemplate(t.body, { name: c.recipientName, event: c.event.title, team: result.team, project: result.project, rank: result.rank });
  const verifyUrl = new URL(`/verify/certificate/${c.publicCode}`, getEnv().APP_URL).toString();
  const bytes = await renderCertificatePdf({
    heading: t.heading, body, recipientName: c.recipientName, eventTitle: c.event.title, issuedAt: c.issuedAt, code: c.publicCode, verifyUrl,
    signatoryName: t.signatoryName, signatoryTitle: t.signatoryTitle, revoked: !!c.revokedAt,
  });
  return { bytes, fileName: `certificate-${c.publicCode}.pdf` };
}

async function loadResultFacts(db: Pick<Tx, "registration" | "submission" | "result">, eventId: string, userId: string) {
  const reg = await db.registration.findUnique({ where: { eventId_userId: { eventId, userId } }, select: { teamId: true, team: { select: { name: true } } } });
  const sub = await db.submission.findFirst({ where: reg?.teamId ? { eventId, teamId: reg.teamId } : { eventId, ownerId: userId, teamId: null }, select: { id: true, title: true } });
  const res = sub ? await db.result.findUnique({ where: { submissionId: sub.id }, select: { rank: true } }) : null;
  return { team: reg?.team?.name ?? "", project: sub?.title ?? "", rank: res?.rank ? String(res.rank) : "" };
}
