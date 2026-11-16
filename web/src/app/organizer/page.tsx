import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProtectedArea } from "@/components/auth/protected-area";
import { AreaNav } from "@/components/dashboard/area-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { EVENT_CATEGORIES, type EventCategoryKey } from "@/lib/event-categories";
import { formatDate } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
import { canCreateEvents } from "@/server/modules/authz/permissions";
import { listManagedEvents } from "@/server/modules/events/events.service";

export const metadata: Metadata = { title: "Organizer dashboard", robots: { index: false, follow: false } };

export default function OrganizerPage() {
  return (
    <Suspense fallback={<Container className="py-14"><Skeleton className="h-96 w-full" /></Container>}>
      <ProtectedArea anyRole="ORGANIZER" returnTo="/organizer" area="the organizer dashboard">
        <Container className="py-14 sm:py-20">
          <Suspense fallback={<Skeleton className="h-96 w-full" />}>
            <OrganizerContent />
          </Suspense>
        </Container>
      </ProtectedArea>
    </Suspense>
  );
}

async function OrganizerContent() {
  const user = await requireUser("/organizer");
  await connection();
  const events = await listManagedEvents(user);
  const live = events.filter((e) => e.status === "PUBLISHED");
  const totals = events.reduce(
    (t, e) => ({ confirmed: t.confirmed + e.counts.CONFIRMED, waitlisted: t.waitlisted + e.counts.WAITLISTED }),
    { confirmed: 0, waitlisted: 0 },
  );
  const withCapacity = events.filter((e) => e.capacity != null && e.status === "PUBLISHED");
  const seats = withCapacity.reduce((n, e) => n + (e.capacity ?? 0), 0);
  const filled = withCapacity.reduce((n, e) => n + Math.min(e.counts.CONFIRMED, e.capacity ?? 0), 0);

  return (
    <>
      <AreaNav user={user} current="organizer" />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1 font-semibold">Organizer dashboard</h1>
          <p className="mt-2 text-fg-muted">Events you organize. Administrators see every event.</p>
        </div>
        {canCreateEvents(user) && (
          <Button asChild size="lg">
            <Link href="/organizer/events/new">Create event</Link>
          </Button>
        )}
      </div>

      <dl className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Events", events.length],
          ["Published", live.length],
          ["Confirmed registrations", totals.confirmed],
          ["On waiting lists", totals.waitlisted],
        ].map(([label, n]) => (
          <div key={label as string} className="rounded-lg bg-surface p-5 shadow-card">
            <dt className="text-sm text-fg-subtle">{label}</dt>
            <dd className="mt-1 text-h2 font-semibold">{n}</dd>
          </div>
        ))}
      </dl>
      {seats > 0 && (
        <p className="mt-4 text-sm text-fg-muted">
          Seats filled across published events with a capacity: {filled} of {seats} ({Math.round((filled / seats) * 100)}%).
        </p>
      )}

      <section aria-labelledby="events-heading" className="mt-12">
        <h2 id="events-heading" className="text-h2 font-semibold">Your events</h2>
        {events.length === 0 ? (
          <EmptyState
            className="mt-6"
            title="No events yet"
            description="Create a draft, add dates and publish it when it is ready."
            action={canCreateEvents(user) ? <Button asChild><Link href="/organizer/events/new">Create your first event</Link></Button> : undefined}
          />
        ) : (
          <div className="mt-6 overflow-x-auto rounded-lg shadow-card" tabIndex={0} role="region" aria-label="Your events">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="border-b border-border-strong text-fg-subtle">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Event</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Starts</th>
                  <th scope="col" className="px-4 py-3 font-medium">Registrations closes</th>
                  <th scope="col" className="px-4 py-3 font-medium">Confirmed</th>
                  <th scope="col" className="px-4 py-3 font-medium">Waiting</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0">
                    <th scope="row" className="px-4 py-3 font-medium">
                      <Link href={`/organizer/events/${e.id}`} className="underline underline-offset-4">{e.title}</Link>
                      <span className="mt-0.5 block text-xs font-normal text-fg-subtle">{EVENT_CATEGORIES[e.category as EventCategoryKey]?.label ?? e.category}</span>
                    </th>
                    <td className="px-4 py-3"><Badge className="text-fg">{e.status[0] + e.status.slice(1).toLowerCase()}</Badge></td>
                    <td className="px-4 py-3"><time dateTime={e.startsAt.toISOString()}>{formatDate(e.startsAt, "UTC")}</time></td>
                    <td className="px-4 py-3"><time dateTime={e.registrationClosesAt.toISOString()}>{formatDate(e.registrationClosesAt, "UTC")}</time></td>
                    <td className="px-4 py-3">{e.counts.CONFIRMED}{e.capacity != null ? ` / ${e.capacity}` : ""}</td>
                    <td className="px-4 py-3">{e.counts.WAITLISTED}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
