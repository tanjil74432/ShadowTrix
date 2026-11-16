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
import { listAdminTeams, teamsQuerySchema } from "@/server/modules/admin/admin-ops.service";

export const metadata: Metadata = { title: "Teams", robots: { index: false, follow: false } };

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={adminFallback}>
      <AdminShell section="teams" returnTo="/admin/teams"><List searchParams={searchParams} /></AdminShell>
    </Suspense>
  );
}

async function List({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireUser("/admin/teams");
  await connection();
  const sp = await searchParams;
  const parsed = teamsQuerySchema.safeParse({ q: first(sp.q), status: first(sp.status), eventId: first(sp.eventId), page: first(sp.page) });
  const q = parsed.success ? parsed.data : teamsQuerySchema.parse({});
  const { items, total, page, pageSize } = await listAdminTeams(actor, q);
  return (
    <>
      <PageHeading title="Teams" intro="Every team across events. Search by team name, event or leader. Teams are disbanded by their leader; administrators can inspect them here." />
      <form method="get" action="/admin/teams" role="search" aria-label="Filter teams" className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <div className="flex flex-col gap-1.5"><label htmlFor="t-q" className="text-sm font-medium">Search</label><Input id="t-q" name="q" type="search" defaultValue={q.q ?? ""} maxLength={100} placeholder="Team, event or leader" /></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="t-s" className="text-sm font-medium">Status</label><Select id="t-s" name="status" defaultValue={q.status ?? ""}><option value="">Any</option><option value="ACTIVE">Active</option><option value="DISBANDED">Disbanded</option></Select></div>
        <Button type="submit">Apply</Button>
        {q.eventId && <input type="hidden" name="eventId" value={q.eventId} />}
      </form>
      <p className="mt-4 text-sm text-fg-muted" role="status">{total} {total === 1 ? "team" : "teams"}</p>
      {items.length === 0 ? <EmptyState className="mt-4" title="No teams found" /> : (
        <DataTable caption="Teams" columns={["Team", "Event", "Leader", "Members", "Submission", "Status", "Created"]} minWidth="56rem">
          {items.map((t) => (
            <tr key={t.id}>
              <th scope="row" className={`${cell} font-medium`}><Link href={`/admin/teams/${t.id}`} className="underline underline-offset-4">{t.name}</Link></th>
              <td className={cell}>{t.event.title}</td><td className={cell}>{t.leader.fullName}</td><td className={cell}>{t._count.members}</td>
              <td className={cell}>{t.submission ? t.submission.status.replace("_", " ").toLowerCase() : "none"}</td>
              <td className={cell}><Chip tone={t.status === "ACTIVE" ? "good" : "neutral"}>{t.status === "ACTIVE" ? "Active" : "Disbanded"}</Chip></td>
              <td className={cell}><time dateTime={t.createdAt.toISOString()}>{formatDateTime(t.createdAt, "UTC")}</time></td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pager page={page} total={total} pageSize={pageSize} hrefFor={(p) => hrefWith("/admin/teams", { q: q.q, status: q.status, eventId: q.eventId }, p)} />
    </>
  );
}
