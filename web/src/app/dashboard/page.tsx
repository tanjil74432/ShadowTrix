import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AreaNav } from "@/components/dashboard/area-nav";
import { RegistrationRow } from "@/components/dashboard/registration-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/roles";
import { requireUser } from "@/server/modules/auth/dal";
import { listMyRegistrations } from "@/server/modules/events/registrations.service";
import { listMyCertificates } from "@/server/modules/certificates/certificates.service";
import { listMyInvitations, listMyTeams } from "@/server/modules/teams/teams.service";
import { InvitationResponse } from "@/components/team/invitation-response";

export const metadata: Metadata = { title: "My dashboard", robots: { index: false, follow: false } };

export default function DashboardPage() {
  return (
    <Container className="py-14 sm:py-20">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <DashboardContent />
      </Suspense>
    </Container>
  );
}

async function DashboardContent() {
  const user = await requireUser("/dashboard");
  await connection();
  const now = new Date();
  const [mine, teams, invitations, certificates] = await Promise.all([
    listMyRegistrations(user.id),
    listMyTeams(user.id),
    listMyInvitations({ email: user.email }, now),
    listMyCertificates(user.id),
  ]);
  const active = mine.filter((r) => r.status !== "CANCELLED");
  const upcoming = active.filter((r) => r.event.endsAt > now && r.event.status !== "CANCELLED").sort((a, b) => a.event.startsAt.getTime() - b.event.startsAt.getTime());
  const past = active.filter((r) => r.event.endsAt <= now || r.event.status === "CANCELLED");
  const cancelled = mine.filter((r) => r.status === "CANCELLED");

  // Deadlines the person can act on: the next dates of events they are registered for.
  const deadlines = upcoming
    .flatMap((r) => [
      { at: r.event.registrationClosesAt, label: "Registration closes", event: r.event },
      { at: r.event.startsAt, label: "Event starts", event: r.event },
      ...(r.event.submissionDeadline ? [{ at: r.event.submissionDeadline, label: "Submission deadline", event: r.event }] : []),
    ])
    .filter((d) => d.at > now)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, 5);

  const roles = [...new Set(user.roles.map((r) => r.role))];

  return (
    <>
      <AreaNav user={user} current="overview" />
      <p className="text-sm font-medium text-fg-muted">Signed in</p>
      <h1 className="mt-2 text-h1 font-semibold text-balance">Welcome, {user.fullName}</h1>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
        <span className="break-all">{user.email}</span>
        {roles.map((r) => (
          <Badge key={r} className="text-fg">
            {ROLE_LABEL[r] ?? r}
          </Badge>
        ))}
      </div>

      <dl className="mt-10 grid gap-4 sm:grid-cols-3">
        {[
          ["Upcoming events", upcoming.length],
          ["Past events", past.length],
          ["Cancelled", cancelled.length],
        ].map(([label, n]) => (
          <div key={label as string} className="rounded-lg bg-surface p-5 shadow-card">
            <dt className="text-sm text-fg-subtle">{label}</dt>
            <dd className="mt-1 text-h2 font-semibold">{n}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="registered-heading">
          <h2 id="registered-heading" className="text-h2 font-semibold">My registered events</h2>
          {active.length === 0 ? (
            <EmptyState
              className="mt-6"
              title="You have not registered for any event yet"
              description="Browse the published events and reserve your place."
              action={<Button asChild><Link href="/events">Browse events</Link></Button>}
            />
          ) : (
            <ul className="mt-6 space-y-3">
              {[...upcoming, ...past].map((r) => (
                <RegistrationRow key={r.id} registration={r} now={now} />
              ))}
            </ul>
          )}
          {cancelled.length > 0 && (
            <details className="mt-8">
              <summary className="cursor-pointer text-sm font-medium text-fg-muted">Cancelled registrations ({cancelled.length})</summary>
              <ul className="mt-4 space-y-3">
                {cancelled.map((r) => (
                  <RegistrationRow key={r.id} registration={r} now={now} />
                ))}
              </ul>
            </details>
          )}
        </section>

        <section aria-labelledby="deadlines-heading">
          <h2 id="deadlines-heading" className="text-h3 font-semibold">Upcoming deadlines</h2>
          {deadlines.length === 0 ? (
            <p className="mt-4 text-fg-muted">Nothing coming up. Deadlines of events you registered for appear here.</p>
          ) : (
            <ol className="mt-4 space-y-4">
              {deadlines.map((d, i) => (
                <li key={`${d.event.id}-${i}`} className="border-l border-border-strong pl-4">
                  <p className="text-sm text-fg-subtle">{d.label}</p>
                  <p className="font-medium">
                    <Link href={`/events/${d.event.slug}`} className="underline underline-offset-4">{d.event.title}</Link>
                  </p>
                  <time className="text-sm text-fg-muted" dateTime={d.at.toISOString()}>{formatDateTime(d.at, d.event.timezone)}</time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {invitations.length > 0 && (
        <section aria-labelledby="invitations-heading" className="mt-12 max-w-3xl">
          <h2 id="invitations-heading" className="text-h2 font-semibold">Team invitations</h2>
          <ul className="mt-6 space-y-3">
            {invitations.map((i) => (
              <li key={i.id} className="space-y-3 rounded-lg bg-surface p-4 shadow-card">
                <p>
                  <strong>{i.inviter.fullName}</strong> invited you to join <strong>{i.team.name}</strong> for{" "}
                  <Link href={`/events/${i.team.event.slug}`} className="underline underline-offset-4">{i.team.event.title}</Link>.
                </p>
                <InvitationResponse id={i.id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {teams.length > 0 && (
        <section aria-labelledby="teams-heading" className="mt-12 max-w-3xl">
          <h2 id="teams-heading" className="text-h2 font-semibold">My teams</h2>
          <ul className="mt-6 space-y-3">
            {teams.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-4 shadow-card">
                <span>
                  <Link href={`/teams/${t.id}`} className="font-medium underline underline-offset-4">{t.name}</Link>
                  <span className="block text-sm text-fg-muted">{t.event.title} - {t._count.members} {t._count.members === 1 ? "member" : "members"}{t.leaderId === user.id ? " - you lead" : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {certificates.length > 0 && (
        <section aria-labelledby="certificates-heading" className="mt-12 max-w-3xl">
          <h2 id="certificates-heading" className="text-h2 font-semibold">My certificates</h2>
          <ul className="mt-6 space-y-3">
            {certificates.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-4 shadow-card">
                <span>
                  <span className="font-medium">{c.event.title}</span>
                  <span className="block text-sm text-fg-muted">
                    {c.type[0] + c.type.slice(1).toLowerCase()} - <Link href={`/verify/certificate/${c.publicCode}`} className="underline underline-offset-4">{c.publicCode}</Link>
                    {c.revokedAt ? " - revoked" : ""}
                  </span>
                </span>
                {!c.revokedAt && (
                  <Button asChild variant="secondary">
                    <a href={`/api/v1/certificates/${c.id}/pdf`} download>Download PDF</a>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
