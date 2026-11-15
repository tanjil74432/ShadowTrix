import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { EventTimeline } from "@/components/event/event-timeline";
import { RegistrationPanel, type RegistrationView } from "@/components/event/registration-panel";
import { CategoryBadge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { getEnv } from "@/server/config/env";
import { toEventSummary } from "@/lib/event-mapping";
import { formatDateRange } from "@/lib/format";
import { getCurrentUser } from "@/server/modules/auth/dal";
import { BLOCK_MESSAGE, registrationBlock } from "@/server/modules/events/event-lifecycle";
import { getPublicEvent } from "@/server/modules/events/events.service";
import { getMyRegistration } from "@/server/modules/events/registrations.service";

type Params = Promise<{ slug: string }>;

/**
 * Static metadata only: reading the database in generateMetadata would make the whole route block prerendering.
 * The event's own title and description are rendered as hoisted <title>/<meta> elements inside the streamed content.
 */
export const metadata: Metadata = { title: "Event" };

export default function EventDetailPage({ params }: { params: Params }) {
  return (
    <Container className="py-14 sm:py-20">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <EventDetail params={params} />
      </Suspense>
    </Container>
  );
}

async function EventDetail({ params }: { params: Params }) {
  await connection();
  const { slug } = await params;
  const event = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) ? await getPublicEvent(slug) : null;
  if (!event) notFound();

  const now = new Date();
  const summary = toEventSummary(event, now);
  const user = await getCurrentUser();
  const mine = user ? await getMyRegistration(user.id, event.id) : null;
  const block = registrationBlock(event, now);
  const full = event.capacity != null && event.confirmedCount >= event.capacity;

  let view: RegistrationView;
  if (mine && (mine.status === "CONFIRMED" || mine.status === "WAITLISTED")) view = { kind: "registered", status: mine.status, canCancel: now < event.endsAt };
  else if (block) view = user ? { kind: "blocked", message: BLOCK_MESSAGE[block] } : { kind: "anonymous", loginHref: "", blocked: BLOCK_MESSAGE[block] };
  else if (!user) view = { kind: "anonymous", loginHref: `/login?next=${encodeURIComponent(`/events/${event.slug}`)}` };
  else view = { kind: "open", full };

  const hosts = event.hosts.map((h) => h.organization.name);
  const where = event.locationType === "ONLINE" ? "Online" : [event.locationType === "HYBRID" ? "Hybrid" : "On site", event.location].filter(Boolean).join(": ");

  return (
    <article>
      <title>{event.title}</title>
      <meta name="description" content={event.summary} />
      <link rel="canonical" href={new URL(`/events/${event.slug}`, getEnv().APP_URL).toString()} />
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <Link href="/events" className="underline underline-offset-4">
          Events
        </Link>
      </nav>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <CategoryBadge category={summary.category} />
        <StatusBadge status={summary.status} />
      </div>
      <h1 className="mt-4 max-w-3xl text-h1 font-semibold text-balance">{event.title}</h1>
      <p className="mt-3 max-w-3xl text-body-lg text-fg-muted text-pretty">{event.summary}</p>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-10">
          <section aria-labelledby="about-heading">
            <h2 id="about-heading" className="text-h2 font-semibold">About this event</h2>
            <div className="mt-4 max-w-3xl space-y-4 text-fg-muted">
              {event.description.split(/\n{2,}/).map((para, i) => (
                <p key={i} className="whitespace-pre-line text-pretty">
                  {para}
                </p>
              ))}
            </div>
          </section>
          {event.eligibility && (
            <section aria-labelledby="eligibility-heading">
              <h2 id="eligibility-heading" className="text-h2 font-semibold">Who can take part</h2>
              <p className="mt-4 max-w-3xl text-fg-muted text-pretty">{event.eligibility}</p>
            </section>
          )}
          <section aria-labelledby="timeline-heading">
            <h2 id="timeline-heading" className="text-h2 font-semibold">Timeline</h2>
            <EventTimeline className="mt-6" timeline={summary.timeline} timezone={event.timezone} />
          </section>
        </div>

        <aside className="space-y-6" aria-label="Event facts and registration">
          <RegistrationPanel eventId={event.id} view={view} />
          <dl className="space-y-4 rounded-lg bg-surface p-6 shadow-card text-sm">
            <div>
              <dt className="text-fg-subtle">Date</dt>
              <dd className="mt-0.5 font-medium">{formatDateRange(event.startsAt, event.endsAt, event.timezone)}</dd>
            </div>
            <div>
              <dt className="text-fg-subtle">Format</dt>
              <dd className="mt-0.5 font-medium">{where}</dd>
            </div>
            <div>
              <dt className="text-fg-subtle">Places</dt>
              <dd className="mt-0.5 font-medium">
                {event.capacity == null ? "No limit" : `${Math.min(event.confirmedCount, event.capacity)} of ${event.capacity} taken`}
              </dd>
            </div>
            {hosts.length > 0 && (
              <div>
                <dt className="text-fg-subtle">Hosted by</dt>
                <dd className="mt-0.5 font-medium">{hosts.join(", ")}</dd>
              </div>
            )}
          </dl>
        </aside>
      </div>
    </article>
  );
}
