import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { adminFallback, cell, Chip, DataTable, first, hrefWith, PageHeading, type SearchParams } from "@/components/admin/admin-ui";
import { AdminShell } from "@/components/admin/admin-shell";
import { Pager } from "@/components/admin/pager";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
import { listAdminSubmissions, submissionsQuerySchema } from "@/server/modules/admin/admin-ops.service";

export const metadata: Metadata = { title: "Submissions", robots: { index: false, follow: false } };
const STATUSES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "SCORED", "DISQUALIFIED"] as const;
const label = (s: string) => s[0] + s.slice(1).toLowerCase().replace("_", " ");

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={adminFallback}>
      <AdminShell section="submissions" returnTo="/admin/submissions"><List searchParams={searchParams} /></AdminShell>
    </Suspense>
  );
}

async function List({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireUser("/admin/submissions");
  await connection();
  const sp = await searchParams;
  const parsed = submissionsQuerySchema.safeParse({ q: first(sp.q), status: first(sp.status), eventId: first(sp.eventId), teamId: first(sp.teamId), from: first(sp.from), to: first(sp.to), page: first(sp.page) });
  const q = parsed.success ? parsed.data : submissionsQuerySchema.parse({});
  const { items, total, page, pageSize } = await listAdminSubmissions(actor, q);
  return (
    <>
      <PageHeading title="Submissions" intro="Project submissions across events. Files are never listed with their storage location: open a submission to download through the authorized link." />
      <form method="get" action="/admin/submissions" role="search" aria-label="Filter submissions" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_11rem_10rem_10rem_auto] lg:items-end">
        <div className="flex flex-col gap-1.5"><label htmlFor="s-q" className="text-sm font-medium">Search</label><Input id="s-q" name="q" type="search" defaultValue={q.q ?? ""} maxLength={100} placeholder="Title, team or author" /></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="s-s" className="text-sm font-medium">Status</label><Select id="s-s" name="status" defaultValue={q.status ?? ""}><option value="">Any</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="s-f" className="text-sm font-medium">Submitted from</label><Input id="s-f" name="from" type="date" defaultValue={q.from ?? ""} /></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="s-t" className="text-sm font-medium">Submitted to</label><Input id="s-t" name="to" type="date" defaultValue={q.to ?? ""} /></div>
        <Button type="submit">Apply</Button>
        {q.eventId && <input type="hidden" name="eventId" value={q.eventId} />}
        {q.teamId && <input type="hidden" name="teamId" value={q.teamId} />}
      </form>
      <p className="mt-4 text-sm text-fg-muted" role="status">{total} {total === 1 ? "submission" : "submissions"}</p>
      {items.length === 0 ? <EmptyState className="mt-4" title="No submissions found" /> : (
        <DataTable caption="Submissions" columns={["Title", "Event", "Team or author", "Status", "Submitted", "Files", "Version"]} minWidth="58rem">
          {items.map((s) => (
            <tr key={s.id}>
              <th scope="row" className={`${cell} font-medium`}><Link href={`/admin/submissions/${s.id}`} className="underline underline-offset-4">{s.title}</Link></th>
              <td className={cell}>{s.event.title}</td><td className={cell}>{s.team?.name ?? s.owner.fullName}</td>
              <td className={cell}><Chip tone={s.status === "DISQUALIFIED" ? "bad" : s.status === "SCORED" ? "good" : "neutral"}>{label(s.status)}</Chip></td>
              <td className={cell}>{s.submittedAt ? <time dateTime={s.submittedAt.toISOString()}>{formatDateTime(s.submittedAt, "UTC")}</time> : "Not submitted"}</td>
              <td className={cell}>{s._count.files}</td><td className={cell}>{s.currentVersion}</td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pager page={page} total={total} pageSize={pageSize} hrefFor={(p) => hrefWith("/admin/submissions", { q: q.q, status: q.status, eventId: q.eventId, teamId: q.teamId, from: q.from, to: q.to }, p)} />
    </>
  );
}
