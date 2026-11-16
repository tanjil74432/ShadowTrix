import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { adminFallback, cell, Chip, DataTable, first, hrefWith, PageHeading, type SearchParams } from "@/components/admin/admin-ui";
import { AdminShell } from "@/components/admin/admin-shell";
import { Pager } from "@/components/admin/pager";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
import { announcementListSchema, listAnnouncementsAdmin } from "@/server/modules/admin/announcements.service";

export const metadata: Metadata = { title: "Announcements", robots: { index: false, follow: false } };
export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={adminFallback}>
      <AdminShell section="announcements" returnTo="/admin/announcements"><List searchParams={searchParams} /></AdminShell>
    </Suspense>
  );
}

const AUDIENCE = { ALL: "Everyone signed in", PARTICIPANTS: "Participants", ORGANIZERS: "Organizers", JUDGES: "Judges" } as const;

async function List({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireUser("/admin/announcements");
  await connection();
  const sp = await searchParams;
  const parsed = announcementListSchema.safeParse({ state: first(sp.state), page: first(sp.page) });
  const q = parsed.success ? parsed.data : announcementListSchema.parse({});
  const { items, total, page, pageSize } = await listAnnouncementsAdmin(actor, q);
  return (
    <>
      <PageHeading title="Announcements" intro="Messages shown on the dashboard of signed-in people. New announcements start as drafts; publish now or schedule for later." actions={<Button asChild><Link href="/admin/announcements/new">New announcement</Link></Button>} />
      <form method="get" action="/admin/announcements" role="search" aria-label="Filter announcements" className="grid gap-4 sm:grid-cols-[12rem_auto] sm:items-end">
        <div className="flex flex-col gap-1.5"><label htmlFor="a-s" className="text-sm font-medium">State</label><Select id="a-s" name="state" defaultValue={q.state ?? ""}><option value="">Any</option><option value="DRAFT">Draft</option><option value="SCHEDULED">Scheduled</option><option value="PUBLISHED">Published</option></Select></div>
        <Button type="submit">Apply</Button>
      </form>
      <p className="mt-4 text-sm text-fg-muted" role="status">{total} {total === 1 ? "announcement" : "announcements"}</p>
      {items.length === 0 ? <EmptyState className="mt-4" title="No announcements" description="Create one to reach participants, organizers or judges." /> : (
        <DataTable caption="Announcements" columns={["Title", "State", "Audience", "Event", "Publishes", "Last edited"]} minWidth="54rem">
          {items.map((a) => (
            <tr key={a.id}>
              <th scope="row" className={`${cell} font-medium`}><Link href={`/admin/announcements/${a.id}`} className="underline underline-offset-4">{a.title}</Link></th>
              <td className={cell}><Chip tone={a.state === "PUBLISHED" ? "good" : a.state === "SCHEDULED" ? "warn" : "neutral"}>{a.state[0] + a.state.slice(1).toLowerCase()}</Chip></td>
              <td className={cell}>{AUDIENCE[a.audience]}</td><td className={cell}>{a.event?.title ?? "Whole platform"}</td>
              <td className={cell}>{a.publishedAt ? <time dateTime={a.publishedAt.toISOString()}>{formatDateTime(a.publishedAt, "UTC")}</time> : "Not published"}</td>
              <td className={cell}><time dateTime={a.updatedAt.toISOString()}>{formatDateTime(a.updatedAt, "UTC")}</time>{a.updatedBy && <span className="block text-xs text-fg-subtle">by {a.updatedBy.fullName}</span>}</td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pager page={page} total={total} pageSize={pageSize} hrefFor={(p) => hrefWith("/admin/announcements", { state: q.state }, p)} />
    </>
  );
}
