import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { EventTimeline } from "@/components/event/event-timeline";
import { RegistrationPanel, type RegistrationView } from "@/components/event/registration-panel";
import { CategoryBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { CreateTeamForm } from "@/components/team/create-team-form";
import { getMyTeamForEvent } from "@/server/modules/teams/teams.service";
import type { SessionUser } from "@/server/modules/auth/session.service";

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

/** Registration for team events: people form teams and the team leader registers the team (see the team page). */
async function TeamSection({ event, user, registered, now }: { event: NonNullable<Awaited<ReturnType<typeof getPublicEvent>>>; user: SessionUser | null; registered: string | null; now: Date }) {
  const block = registrationBlock(event, now, "team");
  const team = user ? await getMyTeamForEvent(user.id, event.id) : null;
  const min = event.minTeamSize ?? 1;
  const max = event.maxTeamSize;
  return (
    <section aria-labelledby="registration-heading" className="space-y-4 rounded-lg bg-surface p-6 shadow-card">
      <h2 id="registration-heading" className="text-h3 font-semibold">Team registration</h2>
      <p className="text-fg-muted">This event is for teams of {min}{max ? ` to ${max}` : " or more"} people. {event.capacity != null ? `${Math.min(event.confirmedCount, event.capacity)} of ${event.capacity} team places taken.` : ""}</p>
      {!user ? (
        <Button asChild size="lg" className="w-full">
          <Link href={`/login?next=${encodeURIComponent(`/events/${event.slug}`)}`}>Log in to create or join a team</Link>
        </Button>
      ) : team ? (
        <>
          <p role="status" className="rounded-md border border-border-strong bg-surface-raised px-4 py-3 text-sm text-silver">
            You are in the team <strong>{team.name}</strong>
            {registered === "CONFIRMED" ? ". The team is registered." : registered === "WAITLISTED" ? ". The team is on the waiting list." : ". The team is not registered yet."}
          </p>
          <Button asChild className="w-full">
            <Link href={`/teams/${team.teamId}`}>Manage your team</Link>
          </Button>
        </>
      ) : block && block !== "NOT_OPEN_YET" ? (
        <p role="status" className="rounded-md border border-border-strong bg-surface-raised px-4 py-3 text-sm text-silver">{BLOCK_MESSAGE[block]}</p>
      ) : (
        <>
          <p className="text-fg-muted">Create a team and invite your teammates, or open the invitation link you received by email.</p>
          <CreateTeamForm eventId={event.id} />
        </>
      )}
    </section>
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
          {event.registrationMode === "TEAM" ? (
            <TeamSection event={event} user={user} registered={mine?.status ?? null} now={now} />
          ) : (
            <RegistrationPanel eventId={event.id} view={view} />
          )}
          {(event.resultsPublishedAt || mine?.status === "CONFIRMED") && (
            <nav aria-label="Event pages" className="space-y-2 rounded-lg bg-surface p-6 shadow-card text-sm">
              {mine?.status === "CONFIRMED" && event.status === "PUBLISHED" && (
                <p><Link href={`/events/${event.slug}/submission`} className="font-medium underline underline-offset-4">Your project submission</Link></p>
              )}
              {event.resultsPublishedAt && (
                <p><Link href={`/events/${event.slug}/results`} className="font-medium underline underline-offset-4">Results and leaderboard</Link></p>
              )}
            </nav>
          )}
          <dl className="panel-orange space-y-4 rounded-lg p-6 text-sm">
            <div>
              <dt className="text-silver/85">Date</dt>
              <dd className="mt-0.5 font-semibold text-accent-soft">{formatDateRange(event.startsAt, event.endsAt, event.timezone)}</dd>
            </div>
            <div>
              <dt className="text-silver/85">Format</dt>
              <dd className="mt-0.5 font-semibold text-accent-soft">{where}</dd>
            </div>
            <div>
              <dt className="text-silver/85">Places</dt>
              <dd className="mt-0.5 font-semibold text-accent-soft">
                {event.capacity == null ? "No limit" : `${Math.min(event.confirmedCount, event.capacity)} of ${event.capacity} taken`}
              </dd>
            </div>
            {hosts.length > 0 && (
              <div>
                <dt className="text-silver/85">Hosted by</dt>
                <dd className="mt-0.5 font-semibold text-accent-soft">{hosts.join(", ")}</dd>
              </div>
            )}
          </dl>
        </aside>
      </div>
    </article>
  );
}
