import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { Pager } from "@/components/admin/pager";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const fallback = <Container className="py-14"><Skeleton className="h-96 w-full" /></Container>;
import { auditQuerySchema, listAuditLog } from "@/server/modules/admin/admin-management.service";

export const metadata: Metadata = { title: "Audit and security", robots: { index: false, follow: false } };

export default function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  return <Suspense fallback={fallback}><AdminShell section="audit" returnTo="/admin/audit"><Content searchParams={searchParams} /></AdminShell></Suspense>;
}

async function Content({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireUser("/admin/audit");
  await connection();
  const sp = await searchParams;
  const parsed = auditQuerySchema.safeParse({ view: first(sp.view), action: first(sp.action), entityType: first(sp.entityType), actor: first(sp.actor), from: first(sp.from), to: first(sp.to), page: first(sp.page) });
  const q = parsed.success ? parsed.data : auditQuerySchema.parse({});
  const { items, total, page, pageSize } = await listAuditLog(actor, q);
  const href = (p: number) => `/admin/audit?${new URLSearchParams({ view: q.view, ...(q.action ? { action: q.action } : {}), ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.actor ? { actor: q.actor } : {}), ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}), page: String(p) })}`;
  return (
    <>
      <h1 className="text-h1 font-semibold">Audit and security events</h1>
      <p className="mt-2 max-w-3xl text-fg-muted">An append-only record of what people and the system did. Tokens, passwords and hashes are never stored in it, and values of sensitive-looking fields are hidden here.</p>
      <nav aria-label="Views" className="mt-4 flex gap-2 text-sm">
        {(["all", "security", "admin"] as const).map((v) => <Link key={v} href={`/admin/audit?view=${v}`} aria-current={q.view === v ? "page" : undefined} className="rounded-md px-3 py-2 font-medium text-fg-muted hover:text-fg aria-[current=page]:bg-surface-raised aria-[current=page]:text-fg">{v === "all" ? "All events" : v === "security" ? "Security events" : "Administrator actions"}</Link>)}
      </nav>
      <form method="get" action="/admin/audit" role="search" aria-label="Filter the audit log" className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        <input type="hidden" name="view" value={q.view} />
        <div className="flex flex-col gap-1.5"><label htmlFor="a-action" className="text-sm font-medium">Action starts with</label><Input id="a-action" name="action" defaultValue={q.action ?? ""} maxLength={60} /></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="a-actor" className="text-sm font-medium">Person (name or email)</label><Input id="a-actor" name="actor" defaultValue={q.actor ?? ""} maxLength={100} /></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="a-from" className="text-sm font-medium">From</label><Input id="a-from" name="from" type="date" defaultValue={q.from ?? ""} /></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="a-to" className="text-sm font-medium">To</label><Input id="a-to" name="to" type="date" defaultValue={q.to ?? ""} /></div>
        <Button type="submit">Apply</Button>
      </form>
      <p className="mt-4 text-sm text-fg-muted" role="status">{total} {total === 1 ? "entry" : "entries"}</p>
      {items.length === 0 ? <EmptyState className="mt-4" title="No entries match" /> : (
        <div tabIndex={0} role="region" aria-label="Audit log (scrollable table)" className="mt-4 overflow-x-auto rounded-lg shadow-card">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <caption className="sr-only">Audit log</caption>
            <thead className="border-b border-border-strong text-fg-subtle"><tr><th scope="col" className="px-4 py-3 font-medium">When (UTC)</th><th scope="col" className="px-4 py-3 font-medium">Action</th><th scope="col" className="px-4 py-3 font-medium">By</th><th scope="col" className="px-4 py-3 font-medium">About</th><th scope="col" className="px-4 py-3 font-medium">Details</th></tr></thead>
            <tbody className="divide-y divide-border">
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-3"><time dateTime={i.createdAt.toISOString()}>{formatDateTime(i.createdAt, "UTC")}</time></td>
                  <th scope="row" className="px-4 py-3 font-medium">{i.action}</th>
                  <td className="px-4 py-3">{i.actor ? <Link href={`/admin/users/${i.actor.id}`} className="underline underline-offset-4">{i.actor.fullName}</Link> : "system"}</td>
                  <td className="px-4 py-3 break-all text-fg-muted">{i.entityType}{i.entityId ? ` ${i.entityId.slice(0, 8)}` : ""}</td>
                  <td className="px-4 py-3">{i.after != null || i.before != null ? <code className="break-all text-xs text-fg-subtle">{JSON.stringify(i.after ?? i.before).slice(0, 160)}</code> : ""}</td>
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
