import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { ProtectedArea } from "@/components/auth/protected-area";
import { EventForm, type EventFormValues } from "@/components/organizer/event-form";
import { EventStatusControls } from "@/components/organizer/event-status-controls";
import { ApiButton } from "@/components/common/api-button";
import { REVIEW_LABEL } from "@/components/admin/review-labels";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
import { loadManagedEvent } from "@/server/modules/events/events.service";
import { listEventRegistrations } from "@/server/modules/events/registrations.service";

export const metadata: Metadata = { title: "Manage event", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

export default function ManageEventPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<Container className="py-14"><Skeleton className="h-96 w-full" /></Container>}>
      <ManageGate params={params} />
    </Suspense>
  );
}

async function ManageGate({ params }: { params: Params }) {
  const { id } = await params;
  const valid = z.uuid().safeParse(id);
  if (!valid.success) notFound();
  return (
    <ProtectedArea anyRole="ORGANIZER" returnTo={`/organizer/events/${valid.data}`} area="this event">
      <Container className="py-14 sm:py-20">
        <ManageContent id={valid.data} />
      </Container>
    </ProtectedArea>
  );
}

const local = (d: Date | null) => (d ? d.toISOString().slice(0, 16) : "");

async function ManageContent({ id }: { id: string }) {
  const user = await requireUser(`/organizer/events/${id}`);
  await connection();
  // Throws a 404/403 AppError for events the user cannot manage; the not-found page is shown for both.
  let event;
  try {
    event = await loadManagedEvent(user, id);
  } catch {
    notFound();
  }
  const regs = await listEventRegistrations(user, id, { page: 1, pageSize: 50 });
  const values: EventFormValues = {
    title: event.title, category: event.category, summary: event.summary, description: event.description,
    startsAt: local(event.startsAt), endsAt: local(event.endsAt), registrationOpensAt: local(event.registrationOpensAt), registrationClosesAt: local(event.registrationClosesAt),
    submissionDeadline: local(event.submissionDeadline), judgingStartsAt: local(event.judgingStartsAt), judgingEndsAt: local(event.judgingEndsAt), resultsAnnouncementAt: local(event.resultsAnnouncementAt),
    capacity: event.capacity == null ? "" : String(event.capacity), locationType: event.locationType, location: event.location ?? "", eligibility: event.eligibility ?? "",
    registrationMode: event.registrationMode, minTeamSize: event.minTeamSize == null ? "" : String(event.minTeamSize), maxTeamSize: event.maxTeamSize == null ? "" : String(event.maxTeamSize),
  };
  const editable = event.status === "DRAFT" || event.status === "PUBLISHED";

  return (
    <>
      <p className="text-sm"><Link href="/organizer" className="underline underline-offset-4 text-fg-muted">Organizer dashboard</Link></p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-h1 font-semibold text-balance">{event.title}</h1>
        <Badge className="text-fg">{event.status[0] + event.status.slice(1).toLowerCase()}</Badge>
      </div>
      {(event.status === "PUBLISHED" || event.status === "CANCELLED") && (
        <p className="mt-2"><Link href={`/events/${event.slug}`} className="underline underline-offset-4 text-fg-muted">View public page</Link></p>
      )}

      <nav aria-label="Event management" className="mt-6 flex flex-wrap gap-2">
        <Link href={`/organizer/events/${event.id}/judging`} className="rounded-md bg-surface px-3 py-2 text-sm font-medium shadow-card underline-offset-4 hover:underline">Judging: criteria, judges, submissions</Link>
        <Link href={`/organizer/events/${event.id}/results`} className="rounded-md bg-surface px-3 py-2 text-sm font-medium shadow-card underline-offset-4 hover:underline">Results and certificates</Link>
      </nav>

      <section aria-labelledby="status-heading" className="mt-10 space-y-4">
        <h2 id="status-heading" className="text-h3 font-semibold">Publishing</h2>
        <EventStatusControls eventId={event.id} status={event.status} registrationClosed={event.registrationManuallyClosed} />
        {event.status === "DRAFT" && (
          <div className="space-y-2 rounded-lg bg-surface p-4 shadow-card" role="group" aria-label="Administrator review">
            <p className="text-sm"><span className="font-medium">Administrator review:</span> {REVIEW_LABEL[event.reviewStatus]}{event.reviewNote ? ` (${event.reviewNote})` : ""}</p>
            {(event.reviewStatus === "NOT_SUBMITTED" || event.reviewStatus === "CHANGES_REQUESTED" || event.reviewStatus === "REJECTED") && (
              <ApiButton url={`/api/v1/events/${event.id}/review-request`} variant="secondary">{event.reviewStatus === "NOT_SUBMITTED" ? "Submit for review" : "Resubmit for review"}</ApiButton>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="regs-heading" className="mt-12">
        <h2 id="regs-heading" className="text-h3 font-semibold">Registrations</h2>
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div><dt className="inline text-fg-subtle">Confirmed </dt><dd className="inline font-medium">{regs.counts.CONFIRMED}{event.capacity != null ? ` of ${event.capacity}` : ""}</dd></div>
          <div><dt className="inline text-fg-subtle">Waiting </dt><dd className="inline font-medium">{regs.counts.WAITLISTED}</dd></div>
          <div><dt className="inline text-fg-subtle">Cancelled </dt><dd className="inline font-medium">{regs.counts.CANCELLED}</dd></div>
        </dl>
        <p className="mt-3 text-sm text-fg-muted">Names and email addresses are private. Use them only to run this event. Each time this list is opened, it is recorded.</p>
        {regs.items.length === 0 ? (
          <EmptyState className="mt-6" title="No registrations yet" description="People who register will appear here." />
        ) : (
          <div className="mt-6 overflow-x-auto rounded-lg shadow-card" tabIndex={0} role="region" aria-label="Registrations">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b border-border-strong text-fg-subtle">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Name</th>
                  <th scope="col" className="px-4 py-3 font-medium">Email</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Registered</th>
                </tr>
              </thead>
              <tbody>
                {regs.items.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <th scope="row" className="px-4 py-3 font-medium">{r.user.fullName}</th>
                    <td className="px-4 py-3 break-all">{r.user.email}</td>
                    <td className="px-4 py-3">{r.status[0] + r.status.slice(1).toLowerCase()}</td>
                    <td className="px-4 py-3"><time dateTime={r.registeredAt.toISOString()}>{formatDateTime(r.registeredAt, "UTC")}</time></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {regs.total > regs.items.length && <p className="mt-3 text-sm text-fg-muted">Showing the first {regs.items.length} of {regs.total}. Use the API for the full list.</p>}
      </section>

      <section aria-labelledby="edit-heading" className="mt-12 max-w-3xl">
        <h2 id="edit-heading" className="text-h3 font-semibold">Event details</h2>
        {editable ? (
          <div className="mt-6"><EventForm mode="edit" eventId={event.id} values={values} /></div>
        ) : (
          <p className="mt-4 text-fg-muted">A {event.status.toLowerCase()} event can no longer be edited.</p>
        )}
      </section>
    </>
  );
}
