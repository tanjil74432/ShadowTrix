import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { adminFallback, Chip, Facts, HistoryList, PageHeading, Section } from "@/components/admin/admin-ui";
import { AdminShell } from "@/components/admin/admin-shell";
import { ApiButton } from "@/components/common/api-button";
import { EVENT_CATEGORIES } from "@/lib/event-categories";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
import { AppError } from "@/server/http/errors";
import { getEventForReview } from "@/server/modules/admin/event-review.service";
import { REVIEW_LABEL, reviewTone } from "@/components/admin/review-labels";

export const metadata: Metadata = { title: "Review event", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

export default function Page({ params }: { params: Params }) {
  return <Suspense fallback={adminFallback}><Gate params={params} /></Suspense>;
}

async function Gate({ params }: { params: Params }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  return <AdminShell section="event-approvals" returnTo={`/admin/event-approvals/${id.data}`}><Detail id={id.data} /></AdminShell>;
}

async function Detail({ id }: { id: string }) {
  const actor = await requireUser(`/admin/event-approvals/${id}`);
  await connection();
  const e = await getEventForReview(actor, id).catch((err) => { if (err instanceof AppError && err.status === 404) notFound(); throw err; });
  const d = (v: Date | null) => (v ? <time dateTime={v.toISOString()}>{formatDateTime(v, "UTC")}</time> : null);
  const url = `/api/v1/admin/event-reviews/${e.id}`;
  return (
    <>
      <PageHeading title={e.title} trail={[{ label: "Event approvals", href: "/admin/event-approvals" }, { label: e.title }]}
        intro={`${EVENT_CATEGORIES[e.category as keyof typeof EVENT_CATEGORIES]?.label ?? e.category} · ${e.status.toLowerCase()} · review: ${REVIEW_LABEL[e.reviewStatus].toLowerCase()}`} />
      <div className="flex flex-wrap items-center gap-3">
        <Chip tone={reviewTone(e.reviewStatus)}>{REVIEW_LABEL[e.reviewStatus]}</Chip>
        {e.reviewNote && <span className="text-sm text-fg-muted">Last note: {e.reviewNote}{e.reviewedBy ? ` (${e.reviewedBy.fullName})` : ""}</span>}
      </div>
      {e.reviewStatus === "SUBMITTED" ? (
        <div className="mt-5 flex flex-wrap items-start gap-3" role="group" aria-label="Review decision">
          <ApiButton url={url} variant="primary" body={{ decision: "approve" }} confirm="Approve this event? Approval does not publish it.">Approve</ApiButton>
          <ApiButton url={url} body={{ decision: "request_changes" }} askReason="What should the organizer change? (at least 5 characters)">Request changes</ApiButton>
          <ApiButton url={url} body={{ decision: "reject" }} askReason="Why is this event rejected? (at least 5 characters)" confirm="Reject this event? The organizer sees your reason.">Reject</ApiButton>
        </div>
      ) : <p className="mt-5 text-fg-muted">This event is not waiting for a decision.</p>}

      <Section id="what" title="Event details">
        <p className="mb-4 text-fg-muted">{e.summary}</p>
        <Facts items={[
          ["Starts", d(e.startsAt)], ["Ends", d(e.endsAt)], ["Registration opens", d(e.registrationOpensAt)], ["Registration closes", d(e.registrationClosesAt)],
          ["Submission deadline", d(e.submissionDeadline)], ["Judging", e.judgingStartsAt ? <>{d(e.judgingStartsAt)} to {d(e.judgingEndsAt)}</> : null], ["Results announced", d(e.resultsAnnouncementAt)],
          ["Capacity", e.capacity ?? "Unlimited"], ["Registration", e.registrationMode === "TEAM" ? `Teams of ${e.minTeamSize ?? "?"} to ${e.maxTeamSize ?? "?"}` : "Individual"],
          ["Location", `${e.locationType.toLowerCase()}${e.location ? `: ${e.location}` : ""} (${e.timezone})`], ["Eligibility", e.eligibility], ["Schedule items", e.scheduleItems],
        ]} />
        <h3 className="mt-6 font-semibold">Description</h3>
        <p className="mt-1 max-w-3xl whitespace-pre-wrap text-fg-muted">{e.description}</p>
      </Section>
      <Section id="who" title="Organizers and hosts">
        <ul className="space-y-1 text-sm">
          {e.organizers.map((o) => <li key={o.user.id}><Link href={`/admin/users/${o.user.id}`} className="underline underline-offset-4">{o.user.fullName}</Link> <span className="text-fg-subtle">({o.user.email}){o.isLead ? ", lead" : ""}</span></li>)}
          {e.organizers.length === 0 && <li className="text-fg-muted">No organizers.</li>}
        </ul>
        <ul className="mt-3 space-y-1 text-sm">
          {e.hosts.map((h) => <li key={h.organization.name}>{h.organization.name} <span className="text-fg-subtle">({h.role.toLowerCase().replace("_", "-")}, {h.organization.verifiedAt ? "verified" : "not verified"})</span></li>)}
          {e.hosts.length === 0 && <li className="text-fg-muted">No hosting organization.</li>}
        </ul>
      </Section>
      <Section id="hist" title="Approval history"><HistoryList items={e.history} /></Section>
      <p className="mt-8 text-sm"><Link href={`/admin/events/${e.id}`} className="underline underline-offset-4">Manage this event</Link></p>
    </>
  );
}
