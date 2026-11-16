import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { adminFallback, cell, Chip, DataTable, first, hrefWith, PageHeading, type SearchParams } from "@/components/admin/admin-ui";
import { AdminShell } from "@/components/admin/admin-shell";
import { Pager } from "@/components/admin/pager";
import { ApiButton } from "@/components/common/api-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
import { certificatesQuerySchema, listAdminCertificates } from "@/server/modules/admin/admin-ops.service";

export const metadata: Metadata = { title: "Certificates", robots: { index: false, follow: false } };

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={adminFallback}>
      <AdminShell section="certificates" returnTo="/admin/certificates"><List searchParams={searchParams} /></AdminShell>
    </Suspense>
  );
}

async function List({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireUser("/admin/certificates");
  await connection();
  const sp = await searchParams;
  const parsed = certificatesQuerySchema.safeParse({ q: first(sp.q), type: first(sp.type), status: first(sp.status), eventId: first(sp.eventId), page: first(sp.page) });
  const q = parsed.success ? parsed.data : certificatesQuerySchema.parse({});
  const { items, total, page, pageSize } = await listAdminCertificates(actor, q);
  return (
    <>
      <PageHeading title="Certificates" intro="Issued certificates. Revoking a certificate keeps the record and the public verification page, which then reports it as revoked." />
      <form method="get" action="/admin/certificates" role="search" aria-label="Filter certificates" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_11rem_11rem_auto] lg:items-end">
        <div className="flex flex-col gap-1.5"><label htmlFor="c-q" className="text-sm font-medium">Search</label><Input id="c-q" name="q" type="search" defaultValue={q.q ?? ""} maxLength={100} placeholder="Code, recipient, event or team" /></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="c-t" className="text-sm font-medium">Type</label><Select id="c-t" name="type" defaultValue={q.type ?? ""}><option value="">Any</option><option value="PARTICIPATION">Participation</option><option value="FINALIST">Finalist</option><option value="WINNER">Winner</option></Select></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="c-s" className="text-sm font-medium">Status</label><Select id="c-s" name="status" defaultValue={q.status ?? ""}><option value="">Any</option><option value="issued">Valid</option><option value="revoked">Revoked</option></Select></div>
        <Button type="submit">Apply</Button>
        {q.eventId && <input type="hidden" name="eventId" value={q.eventId} />}
      </form>
      <p className="mt-4 text-sm text-fg-muted" role="status">{total} {total === 1 ? "certificate" : "certificates"}</p>
      {items.length === 0 ? <EmptyState className="mt-4" title="No certificates found" description="Certificates are issued by organizers after results are published." /> : (
        <DataTable caption="Certificates" columns={["Code", "Recipient", "Event", "Type", "Issued", "Status", "Actions"]} minWidth="62rem">
          {items.map((c) => (
            <tr key={c.id}>
              <th scope="row" className={`${cell} font-mono font-medium`}>{c.publicCode}</th>
              <td className={cell}>{c.recipientName}</td><td className={cell}>{c.event.title}</td><td className={cell}>{c.type[0] + c.type.slice(1).toLowerCase()}</td>
              <td className={cell}><time dateTime={c.issuedAt.toISOString()}>{formatDateTime(c.issuedAt, "UTC")}</time>{c.issuedBy && <span className="block text-xs text-fg-subtle">by {c.issuedBy.fullName}</span>}</td>
              <td className={cell}>{c.revokedAt ? <><Chip tone="bad">Revoked</Chip>{c.revokedReason && <span className="mt-1 block text-xs text-fg-subtle">{c.revokedReason}</span>}</> : <Chip tone="good">Valid</Chip>}</td>
              <td className={cell}>
                <span className="flex flex-wrap items-start gap-3">
                  <Link href={`/verify/certificate/${encodeURIComponent(c.publicCode)}`} className="underline underline-offset-4">Public page</Link>
                  {!c.revokedAt && <ApiButton url={`/api/v1/certificates/${c.id}/revoke`} askReason="Why is this certificate revoked? (at least 5 characters)" confirm="Revoke this certificate? The public verification page will show it as revoked.">Revoke</ApiButton>}
                </span>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pager page={page} total={total} pageSize={pageSize} hrefFor={(p) => hrefWith("/admin/certificates", { q: q.q, type: q.type, status: q.status, eventId: q.eventId }, p)} />
    </>
  );
}
