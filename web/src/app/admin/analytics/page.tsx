import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { EVENT_CATEGORIES, type EventCategoryKey } from "@/lib/event-categories";
import { AdminShell } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/modules/auth/dal";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const fallback = <Container className="py-14"><Skeleton className="h-96 w-full" /></Container>;
import { BarList, DailyChart } from "@/components/admin/bar-list";
import { analyticsQuerySchema, getAnalytics } from "@/server/modules/analytics/analytics.service";

export const metadata: Metadata = { title: "Analytics", robots: { index: false, follow: false } };

export default function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  return <Suspense fallback={fallback}><AdminShell section="analytics" returnTo="/admin/analytics"><Content searchParams={searchParams} /></AdminShell></Suspense>;
}

const label = (s: string) => s[0] + s.slice(1).toLowerCase().replace(/_/g, " ");

async function Content({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireUser("/admin/analytics");
  await connection();
  const sp = await searchParams;
  const parsed = analyticsQuerySchema.safeParse({ from: first(sp.from), to: first(sp.to) });
  let a;
  let problem: string | null = parsed.success ? null : "Use dates in the format YYYY-MM-DD.";
  try {
    a = await getAnalytics(actor, parsed.success ? parsed.data : {});
  } catch (e) {
    problem = (e as { message?: string }).message ?? "Invalid range.";
    a = await getAnalytics(actor, {});
  }
  return (
    <>
      <h1 className="text-h1 font-semibold">Analytics</h1>
      <p className="mt-2 max-w-3xl text-fg-muted">Computed from the database on request. Totals cover the whole platform; &quot;in range&quot; figures use the dates below (UTC, at most 366 days).</p>
      <form method="get" action="/admin/analytics" aria-label="Date range" className="mt-6 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5"><label htmlFor="from" className="text-sm font-medium">From</label><Input id="from" name="from" type="date" defaultValue={a.range.from} /></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="to" className="text-sm font-medium">To (inclusive)</label><Input id="to" name="to" type="date" defaultValue={a.range.to} /></div>
        <Button type="submit">Apply</Button>
      </form>
      {problem && <p role="alert" className="mt-3 text-danger">{problem} Showing the default range.</p>}
      <p className="mt-4 text-sm text-fg-muted" role="status">Range: {a.range.from} to {a.range.to} ({a.range.days} days).</p>

      <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {([
          ["Total users", a.users.total], ["Verified, active users", a.users.verifiedActive], ["New users in range", a.users.newInRange], ["Active participants in range", a.users.activeParticipantsInRange],
          ["Organizers", a.organizers.total], ["Active teams", a.teams.active], ["Teams registered", a.teams.registered], ["Average team size", a.teams.averageSize ?? "n/a"],
          ["Submitted in range", a.submissions.submittedInRange], ["Judging completion", a.judging.completionPercent === null ? "n/a" : `${a.judging.completionPercent}%`], ["Results published", a.results.eventsPublished], ["Awaiting publication", a.results.awaitingPublication],
        ] as [string, number | string][]).map(([k, v]) => <div key={k} className="rounded-lg bg-surface p-4 shadow-card"><dt className="text-sm text-fg-subtle">{k}</dt><dd className="mt-1 text-h3 font-semibold">{v}</dd></div>)}
      </dl>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="lg:col-span-2"><DailyChart title="Registrations per day" series={a.registrations.series} /></div>
        <BarList title="Events by status" rows={Object.entries(a.events.byStatus).map(([k, v]) => ({ label: label(k), value: v }))} />
        <BarList title="Events by category (not drafts)" rows={Object.entries(a.events.byCategory).map(([k, v]) => ({ label: k in EVENT_CATEGORIES ? EVENT_CATEGORIES[k as EventCategoryKey].label : label(k), value: v }))} />
        <BarList title="Registrations in range by status" rows={Object.entries(a.registrations.inRange).map(([k, v]) => ({ label: label(k), value: v }))} />
        <BarList title="Individual or through teams (not cancelled)" rows={[{ label: "Individual", value: a.registrations.individual }, { label: "Through teams", value: a.registrations.viaTeams }]} />
        <BarList title="Submissions by status" rows={Object.entries(a.submissions.byStatus).map(([k, v]) => ({ label: label(k), value: v }))} />
        <BarList title="Users by role (any scope)" rows={Object.entries(a.users.byRole).map(([k, v]) => ({ label: label(k), value: v }))} />
        <BarList title="Certificates issued in range" rows={Object.entries(a.certificates.issuedInRange).map(([k, v]) => ({ label: label(k), value: v }))} />
        <BarList title="Organizers with the most events" rows={a.organizers.top.map((o) => ({ label: o.name, value: o.events }))} />
      </div>
      <p className="mt-6 text-sm text-fg-muted">Judging: {a.judging.scorecardsFinalized} of {a.judging.scorecardsExpected} expected scorecards finalized across {a.judging.judgeAssignments} judge assignments. Revoked certificates in total: {a.certificates.revokedTotal}. Accounts suspended: {a.users.suspended}. Events created in range: {a.events.createdInRange}. Results published in range: {a.results.publishedInRange}.</p>
    </>
  );
}
