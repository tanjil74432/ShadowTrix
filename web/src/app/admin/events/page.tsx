import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { Pager } from "@/components/admin/pager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const fallback = <Container className="py-14"><Skeleton className="h-96 w-full" /></Container>;
import { EVENT_CATEGORIES } from "@/lib/event-categories";
import { adminEventsQuerySchema, listAllEvents } from "@/server/modules/admin/admin-management.service";

export const metadata: Metadata = { title: "Events", robots: { index: false, follow: false } };

export default function EventsAdminPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={fallback}>
      <AdminShell section="events" returnTo="/admin/events"><List searchParams={searchParams} /></AdminShell>
    </Suspense>
  );
}

async function List({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireUser("/admin/events");
  await connection();
  const sp = await searchParams;
  const parsed = adminEventsQuerySchema.safeParse({ q: first(sp.q), status: first(sp.status), category: first(sp.category), page: first(sp.page) });
  const q = parsed.success ? parsed.data : adminEventsQuerySchema.parse({});
  const { items, total, page, pageSize } = await listAllEvents(actor, q);
  const href = (p: number) => `/admin/events?${new URLSearchParams({ ...(q.q ? { q: q.q } : {}), ...(q.status ? { status: q.status } : {}), ...(q.category ? { category: q.category } : {}), page: String(p) })}`;
  return (
    <>
      <h1 className="text-h1 font-semibold">Events</h1>
      <p className="mt-2 text-fg-muted">Every event, drafts included. Open one to manage organizers, hosts and status.</p>
      <form method="get" action="/admin/events" role="search" aria-label="Filter events" className="mt-6 grid gap-4 sm:grid-cols-[1fr_12rem_16rem_auto] sm:items-end">
        <div className="flex flex-col gap-1.5"><label htmlFor="ev-q" className="text-sm font-medium">Search</label><Input id="ev-q" name="q" type="search" defaultValue={q.q ?? ""} maxLength={100} /></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="ev-status" className="text-sm font-medium">Status</label>
          <Select id="ev-status" name="status" defaultValue={q.status ?? ""}><option value="">Any</option>{["DRAFT", "PUBLISHED", "CANCELLED", "ARCHIVED"].map((s) => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}</Select></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="ev-cat" className="text-sm font-medium">Category</label>
          <Select id="ev-cat" name="category" defaultValue={q.category ?? ""}><option value="">Any</option>{Object.entries(EVENT_CATEGORIES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</Select></div>
        <Button type="submit">Apply</Button>
      </form>
      <p className="mt-4 text-sm text-fg-muted" role="status">{total} {total === 1 ? "event" : "events"}</p>
      {items.length === 0 ? <EmptyState className="mt-4" title="No events found" /> : (
        <div tabIndex={0} role="region" aria-label="Events (scrollable table)" className="mt-4 overflow-x-auto rounded-lg shadow-card">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <caption className="sr-only">Events</caption>
            <thead className="border-b border-border-strong text-fg-subtle"><tr>
              <th scope="col" className="px-4 py-3 font-medium">Event</th><th scope="col" className="px-4 py-3 font-medium">Status</th><th scope="col" className="px-4 py-3 font-medium">Starts</th><th scope="col" className="px-4 py-3 font-medium">Organizers</th><th scope="col" className="px-4 py-3 font-medium">Confirmed</th><th scope="col" className="px-4 py-3 font-medium">Teams</th><th scope="col" className="px-4 py-3 font-medium">Submissions</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {items.map((e) => (
                <tr key={e.id}>
                  <th scope="row" className="px-4 py-3 font-medium"><Link href={`/admin/events/${e.id}`} className="underline underline-offset-4">{e.title}</Link><span className="block text-xs font-normal text-fg-subtle">{EVENT_CATEGORIES[e.category as keyof typeof EVENT_CATEGORIES]?.label} - {e.registrationMode === "TEAM" ? "teams" : "individual"}</span></th>
                  <td className="px-4 py-3"><Badge className="text-fg">{e.status[0] + e.status.slice(1).toLowerCase()}</Badge></td>
                  <td className="px-4 py-3"><time dateTime={e.startsAt.toISOString()}>{formatDateTime(e.startsAt, "UTC")}</time></td>
                  <td className="px-4 py-3">{e.organizers.map((o) => o.user.fullName).join(", ") || "none"}</td>
                  <td className="px-4 py-3">{e.registrations.CONFIRMED}</td><td className="px-4 py-3">{e._count.teams}</td><td className="px-4 py-3">{e._count.submissions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} total={total} pageSize={pageSize} hrefFor={href} />
    </>
  );
}
