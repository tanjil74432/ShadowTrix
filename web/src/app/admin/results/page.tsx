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
import { listAdminResults, resultsQuerySchema } from "@/server/modules/admin/admin-ops.service";

export const metadata: Metadata = { title: "Results", robots: { index: false, follow: false } };

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={adminFallback}>
      <AdminShell section="results" returnTo="/admin/results"><List searchParams={searchParams} /></AdminShell>
    </Suspense>
  );
}

async function List({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireUser("/admin/results");
  await connection();
  const sp = await searchParams;
  const parsed = resultsQuerySchema.safeParse({ q: first(sp.q), published: first(sp.published), page: first(sp.page) });
  const q = parsed.success ? parsed.data : resultsQuerySchema.parse({});
  const { items, total, page, pageSize } = await listAdminResults(actor, q);
  return (
    <>
      <PageHeading title="Results" intro="Computed results across events. Open an event to inspect rankings and ties, or to publish or unpublish its results." />
      <form method="get" action="/admin/results" role="search" aria-label="Filter results" className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <div className="flex flex-col gap-1.5"><label htmlFor="r-q" className="text-sm font-medium">Search events</label><Input id="r-q" name="q" type="search" defaultValue={q.q ?? ""} maxLength={100} /></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="r-p" className="text-sm font-medium">Publication</label><Select id="r-p" name="published" defaultValue={q.published ?? ""}><option value="">Any</option><option value="yes">Published</option><option value="no">Not published</option></Select></div>
        <Button type="submit">Apply</Button>
      </form>
      <p className="mt-4 text-sm text-fg-muted" role="status">{total} {total === 1 ? "event" : "events"}</p>
      {items.length === 0 ? <EmptyState className="mt-4" title="No results yet" description="Results appear after an organizer calculates them." /> : (
        <DataTable caption="Results by event" columns={["Event", "Ranked entries", "Publication"]} minWidth="34rem">
          {items.map((e) => (
            <tr key={e.id}>
              <th scope="row" className={`${cell} font-medium`}><Link href={`/admin/results/${e.id}`} className="underline underline-offset-4">{e.title}</Link></th>
              <td className={cell}>{e._count.results}</td>
              <td className={cell}>{e.resultsPublishedAt ? <Chip tone="good">Published {formatDateTime(e.resultsPublishedAt, "UTC")}</Chip> : <Chip tone="warn">Not published</Chip>}</td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pager page={page} total={total} pageSize={pageSize} hrefFor={(p) => hrefWith("/admin/results", { q: q.q, published: q.published }, p)} />
    </>
  );
}
