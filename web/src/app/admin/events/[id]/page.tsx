import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { AdminShell } from "@/components/admin/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
const fallback = <Container className="py-14"><Skeleton className="h-96 w-full" /></Container>;
import { ApiButton } from "@/components/common/api-button";
import { JsonForm } from "@/components/admin/json-form";
import { getEventAdminDetail } from "@/server/modules/admin/admin-management.service";
import { listOrganizations } from "@/server/modules/organization/organization.service";

export const metadata: Metadata = { title: "Event administration", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

export default function EventAdminPage({ params }: { params: Params }) {
  return <Suspense fallback={fallback}><Gate params={params} /></Suspense>;
}

async function Gate({ params }: { params: Params }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  return <AdminShell section="events" returnTo={`/admin/events/${id.data}`}><Detail id={id.data} /></AdminShell>;
}

async function Detail({ id }: { id: string }) {
  const actor = await requireUser(`/admin/events/${id}`);
  await connection();
  let e, orgs;
  try {
    [e, orgs] = await Promise.all([getEventAdminDetail(actor, id), listOrganizations(actor)]);
  } catch {
    notFound();
  }
  return (
    <>
      <p className="text-sm"><Link href="/admin/events" className="underline underline-offset-4 text-fg-muted">Events</Link></p>
      <div className="mt-4 flex flex-wrap items-center gap-3"><h1 className="text-h1 font-semibold text-balance">{e.title}</h1><Badge className="text-fg">{e.status[0] + e.status.slice(1).toLowerCase()}</Badge></div>
      <p className="mt-2 text-fg-muted">{e.registrationMode === "TEAM" ? "Team event" : "Individual event"}. Starts <time dateTime={e.startsAt.toISOString()}>{formatDateTime(e.startsAt, "UTC")}</time>. Confirmed {e.registrations.CONFIRMED}{e.capacity ? ` of ${e.capacity}` : ""}, waiting {e.registrations.WAITLISTED}, cancelled {e.registrations.CANCELLED}; {e._count.teams} teams, {e._count.submissions} submissions, {e._count.judges} judges, {e._count.certificates} certificates. {e.resultsPublishedAt ? "Results are published." : "Results are not published."}</p>

      <nav aria-label="Event management pages" className="mt-6 flex flex-wrap gap-2 text-sm">
        <Link href={`/organizer/events/${e.id}`} className="rounded-md bg-surface px-3 py-2 font-medium shadow-card underline-offset-4 hover:underline">Details, publishing and registrations</Link>
        <Link href={`/organizer/events/${e.id}/judging`} className="rounded-md bg-surface px-3 py-2 font-medium shadow-card underline-offset-4 hover:underline">Judging</Link>
        <Link href={`/organizer/events/${e.id}/results`} className="rounded-md bg-surface px-3 py-2 font-medium shadow-card underline-offset-4 hover:underline">Results and certificates</Link>
      </nav>

      <section aria-labelledby="status-heading" className="mt-10 space-y-3">
        <h2 id="status-heading" className="text-h3 font-semibold">Status</h2>
        <div className="flex flex-wrap gap-3">
          {e.status === "PUBLISHED" && <ApiButton url={`/api/v1/events/${e.id}/status`} body={{ action: "cancel" }} confirm="Cancel this event? Registered people will see it as cancelled.">Cancel event</ApiButton>}
          {e.status !== "ARCHIVED" && <ApiButton url={`/api/v1/events/${e.id}/status`} body={{ action: "archive" }} confirm="Archive this event? It disappears from public pages.">Archive event</ApiButton>}
          {e.status === "ARCHIVED" && <p className="text-fg-muted">Archived events are final.</p>}
        </div>
      </section>

      <section aria-labelledby="org-heading" className="mt-10 max-w-2xl space-y-3">
        <h2 id="org-heading" className="text-h3 font-semibold">Organizers</h2>
        <ul className="space-y-2">{e.organizers.map((o) => (
          <li key={o.user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-3 shadow-card"><span>{o.user.fullName} <span className="text-sm text-fg-muted break-all">{o.user.email}</span>{o.isLead && <Badge className="ml-2 text-fg">Lead</Badge>}</span>
            <ApiButton url={`/api/v1/admin/events/${e.id}/organizers/${o.user.id}`} method="DELETE" variant="ghost" confirm={`Remove ${o.user.fullName} as an organizer?`}>Remove</ApiButton></li>
        ))}</ul>
        <JsonForm label="Add an organizer" url={`/api/v1/admin/events/${e.id}/organizers`} submitLabel="Add organizer" successMessage="Organizer added. They are signed out once so the role takes effect." reset fields={[{ name: "email", label: "Email address of a confirmed account", type: "email", required: true }]} />
      </section>

      <section aria-labelledby="hosts-heading" className="mt-10 max-w-2xl space-y-3">
        <h2 id="hosts-heading" className="text-h3 font-semibold">Hosting organizations</h2>
        {e.hosts.length === 0 ? <p className="text-fg-muted">No hosting organization.</p> : <ul className="space-y-2">{e.hosts.map((h) => (
          <li key={h.organization.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-3 shadow-card"><span>{h.organization.name} <Badge>{h.role.replace("_", "-").toLowerCase()}</Badge></span>
            <ApiButton url={`/api/v1/admin/events/${e.id}/hosts/${h.organization.id}`} method="DELETE" variant="ghost">Remove</ApiButton></li>
        ))}</ul>}
        <JsonForm label="Add or change a host" url={`/api/v1/admin/events/${e.id}/hosts`} submitLabel="Save host" reset fields={[
          { name: "organizationId", label: "Organization", type: "select", required: true, options: orgs.map((o) => ({ value: o.id, label: o.name })) },
          { name: "role", label: "Role", type: "select", options: [{ value: "HOST", label: "Host" }, { value: "CO_HOST", label: "Co-host" }, { value: "PARTNER", label: "Partner" }] },
        ]} />
      </section>

      <section aria-labelledby="history-heading" className="mt-10">
        <h2 id="history-heading" className="text-h3 font-semibold">History</h2>
        {e.history.length === 0 ? <p className="mt-3 text-fg-muted">No recorded changes.</p> : <ol className="mt-4 space-y-2">{e.history.map((h) => <li key={h.id} className="rounded-lg bg-surface p-3 text-sm shadow-card"><span className="font-medium">{h.action}</span> <span className="text-fg-muted">by {h.by}, <time dateTime={h.createdAt.toISOString()}>{formatDateTime(h.createdAt, "UTC")}</time></span></li>)}</ol>}
      </section>
    </>
  );
}
