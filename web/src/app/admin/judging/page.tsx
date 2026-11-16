import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { adminFallback, cell, Chip, DataTable, first, hrefWith, PageHeading, type SearchParams } from "@/components/admin/admin-ui";
import { AdminShell } from "@/components/admin/admin-shell";
import { Pager } from "@/components/admin/pager";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
import { getJudgingOverview, judgingQuerySchema } from "@/server/modules/admin/admin-ops.service";

export const metadata: Metadata = { title: "Judging", robots: { index: false, follow: false } };

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={adminFallback}>
      <AdminShell section="judging" returnTo="/admin/judging"><List searchParams={searchParams} /></AdminShell>
    </Suspense>
  );
}

async function List({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireUser("/admin/judging");
  await connection();
  const sp = await searchParams;
  const parsed = judgingQuerySchema.safeParse({ q: first(sp.q), incomplete: first(sp.incomplete), page: first(sp.page) });
  const q = parsed.success ? parsed.data : judgingQuerySchema.parse({});
  const { items, total, page, pageSize } = await getJudgingOverview(actor, q);
  return (
    <>
      <PageHeading title="Judging" intro="Judge allocation and scorecard progress per event. A scorecard counts as complete when the judge has finalized every criterion." />
      <form method="get" action="/admin/judging" role="search" aria-label="Filter judging" className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div className="flex flex-col gap-1.5"><label htmlFor="j-q" className="text-sm font-medium">Search events</label><Input id="j-q" name="q" type="search" defaultValue={q.q ?? ""} maxLength={100} /></div>
        <label className="flex items-center gap-2 pb-3 text-sm"><input type="checkbox" name="incomplete" value="1" defaultChecked={!!q.incomplete} className="size-4 accent-[var(--color-accent)]" />Only incomplete</label>
        <Button type="submit">Apply</Button>
      </form>
      <p className="mt-4 text-sm text-fg-muted" role="status">{total} {total === 1 ? "event" : "events"}</p>
      {items.length === 0 ? <EmptyState className="mt-4" title="Nothing to show" description="Events appear here once they have judges, criteria or submissions." /> : (
        <DataTable caption="Judging progress by event" columns={["Event", "Judges", "Criteria", "Submissions", "Scorecards", "Progress", "Judging ends"]} minWidth="58rem">
          {items.map((e) => (
            <tr key={e.id}>
              <th scope="row" className={`${cell} font-medium`}><Link href={`/admin/judging/${e.id}`} className="underline underline-offset-4">{e.title}</Link></th>
              <td className={cell}>{e._count.judges === 0 ? <Chip tone="warn">None assigned</Chip> : e._count.judges}</td><td className={cell}>{e._count.criteria}</td><td className={cell}>{e.submissions}</td>
              <td className={cell}>{e.completed} of {e.expected}</td>
              <td className={cell}>{e.percent === null ? "n/a" : <span className="flex items-center gap-2"><Progress value={e.completed} max={e.expected} label={`${e.title} judging progress`} className="w-24" />{e.percent}%</span>}</td>
              <td className={cell}>{e.judgingEndsAt ? <time dateTime={e.judgingEndsAt.toISOString()}>{formatDateTime(e.judgingEndsAt, "UTC")}</time> : "Not set"}</td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pager page={page} total={total} pageSize={pageSize} hrefFor={(p) => hrefWith("/admin/judging", { q: q.q, incomplete: q.incomplete }, p)} />
    </>
  );
}
