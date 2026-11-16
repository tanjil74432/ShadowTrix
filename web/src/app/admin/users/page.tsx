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
import { Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const fallback = <Container className="py-14"><Skeleton className="h-96 w-full" /></Container>;
import { ROLE_LABEL } from "@/lib/roles";
import { listUsers } from "@/server/modules/admin/admin-users.service";

export const metadata: Metadata = { title: "Users", robots: { index: false, follow: false } };

export default function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={fallback}>
      <AdminShell section="users" returnTo="/admin/users"><Users searchParams={searchParams} /></AdminShell>
    </Suspense>
  );
}

async function Users({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireUser("/admin/users");
  await connection();
  const sp = await searchParams;
  const q = first(sp.q);
  const page = Math.max(1, Math.min(10_000, Number(first(sp.page)) || 1));
  const { items, total, pageSize } = await listUsers(actor, { page, pageSize: 25, q });
  const href = (p: number) => `/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;
  return (
    <>
      <h1 className="text-h1 font-semibold">Users</h1>
      <form method="get" action="/admin/users" role="search" aria-label="Search users" className="mt-6 flex max-w-xl gap-3">
        <label htmlFor="user-q" className="sr-only">Search by name or email</label>
        <Input id="user-q" name="q" type="search" defaultValue={q ?? ""} maxLength={100} placeholder="Name or email" />
        <Button type="submit">Search</Button>
      </form>
      <p className="mt-4 text-sm text-fg-muted" role="status">{total} {total === 1 ? "user" : "users"}</p>
      {items.length === 0 ? <EmptyState className="mt-4" title="No users found" /> : (
        <div tabIndex={0} role="region" aria-label="Users (scrollable table)" className="mt-4 overflow-x-auto rounded-lg shadow-card">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <caption className="sr-only">Users</caption>
            <thead className="border-b border-border-strong text-fg-subtle"><tr>
              <th scope="col" className="px-4 py-3 font-medium">Name</th><th scope="col" className="px-4 py-3 font-medium">Email</th><th scope="col" className="px-4 py-3 font-medium">Roles</th><th scope="col" className="px-4 py-3 font-medium">Status</th><th scope="col" className="px-4 py-3 font-medium">Joined</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {items.map((u) => (
                <tr key={u.id}>
                  <th scope="row" className="px-4 py-3 font-medium"><Link href={`/admin/users/${u.id}`} className="underline underline-offset-4">{u.fullName}</Link></th>
                  <td className="px-4 py-3 break-all text-fg-muted">{u.email}</td>
                  <td className="px-4 py-3"><span className="flex flex-wrap gap-1.5">{[...new Set(u.roles.map((r) => r.role))].map((r) => <Badge key={r}>{ROLE_LABEL[r] ?? r}</Badge>)}</span></td>
                  <td className="px-4 py-3">{u.status === "SUSPENDED" ? "Suspended" : u.emailVerified ? "Active" : "Awaiting confirmation"}</td>
                  <td className="px-4 py-3"><time dateTime={u.createdAt.toISOString()}>{formatDateTime(u.createdAt, "UTC")}</time></td>
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
