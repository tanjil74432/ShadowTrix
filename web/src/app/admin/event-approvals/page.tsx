import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { adminFallback, cell, Chip, DataTable, first, hrefWith, PageHeading, type SearchParams } from "@/components/admin/admin-ui";
import { AdminShell } from "@/components/admin/admin-shell";
import { REVIEW_LABEL, reviewTone } from "@/components/admin/review-labels";
import { Pager } from "@/components/admin/pager";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
import { listEventReviews, reviewQuerySchema } from "@/server/modules/admin/event-review.service";

export const metadata: Metadata = { title: "Event approvals", robots: { index: false, follow: false } };
export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={adminFallback}>
      <AdminShell section="event-approvals" returnTo="/admin/event-approvals"><List searchParams={searchParams} /></AdminShell>
    </Suspense>
  );
}

async function List({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireUser("/admin/event-approvals");
  await connection();
  const sp = await searchParams;
  const parsed = reviewQuerySchema.safeParse({ q: first(sp.q), review: first(sp.review), page: first(sp.page) });
  const q = parsed.success ? parsed.data : reviewQuerySchema.parse({});
  const { items, total, page, pageSize } = await listEventReviews(actor, q);
  return (
    <>
      <PageHeading title="Event approvals" intro="Organizers submit draft events for review. Approval is separate from publishing: it only gates publishing when approval is required in Settings." />
      <form method="get" action="/admin/event-approvals" role="search" aria-label="Filter events under review" className="grid gap-4 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
        <div className="flex flex-col gap-1.5"><label htmlFor="ea-q" className="text-sm font-medium">Search</label><Input id="ea-q" name="q" type="search" defaultValue={q.q ?? ""} maxLength={100} /></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="ea-s" className="text-sm font-medium">Review status</label>
          <Select id="ea-s" name="review" defaultValue={q.review ?? ""}><option value="">All submitted</option>{Object.entries(REVIEW_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></div>
        <Button type="submit">Apply</Button>
      </form>
      <p className="mt-4 text-sm text-fg-muted" role="status">{total} {total === 1 ? "event" : "events"}</p>
      {items.length === 0 ? <EmptyState className="mt-4" title="No events to review" description="Events appear here when an organizer submits a draft for review." /> : (
        <DataTable caption="Events under review" columns={["Event", "Review", "Event status", "Organizers", "Starts", "Updated"]}>
          {items.map((e) => (
            <tr key={e.id}>
              <th scope="row" className={`${cell} font-medium`}><Link href={`/admin/event-approvals/${e.id}`} className="underline underline-offset-4">{e.title}</Link></th>
              <td className={cell}><Chip tone={reviewTone(e.reviewStatus)}>{REVIEW_LABEL[e.reviewStatus]}</Chip></td>
              <td className={cell}>{e.status[0] + e.status.slice(1).toLowerCase()}</td>
              <td className={cell}>{e.organizers.map((o) => o.user.fullName).join(", ") || "none"}</td>
              <td className={cell}><time dateTime={e.startsAt.toISOString()}>{formatDateTime(e.startsAt, "UTC")}</time></td>
              <td className={cell}><time dateTime={e.updatedAt.toISOString()}>{formatDateTime(e.updatedAt, "UTC")}</time></td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pager page={page} total={total} pageSize={pageSize} hrefFor={(p) => hrefWith("/admin/event-approvals", { q: q.q, review: q.review }, p)} />
    </>
  );
}
