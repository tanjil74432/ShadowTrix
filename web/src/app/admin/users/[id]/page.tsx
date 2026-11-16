import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { AdminShell } from "@/components/admin/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
const fallback = <Container className="py-14"><Skeleton className="h-96 w-full" /></Container>;
import { UserActions } from "@/components/admin/user-actions";
import { ROLE_LABEL } from "@/lib/roles";
import { getUserDetail } from "@/server/modules/admin/admin-management.service";

export const metadata: Metadata = { title: "User", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

export default function UserPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={fallback}>
      <Gate params={params} />
    </Suspense>
  );
}

async function Gate({ params }: { params: Params }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  return <AdminShell section="users" returnTo={`/admin/users/${id.data}`}><Detail id={id.data} /></AdminShell>;
}

async function Detail({ id }: { id: string }) {
  const actor = await requireUser(`/admin/users/${id}`);
  await connection();
  let u;
  try {
    u = await getUserDetail(actor, id);
  } catch {
    notFound();
  }
  const globalRoles = u.roles.filter((r) => !r.eventId && !r.organizationId).map((r) => r.role as string);
  return (
    <>
      <p className="text-sm"><Link href="/admin/users" className="underline underline-offset-4 text-fg-muted">Users</Link></p>
      <h1 className="mt-4 text-h1 font-semibold text-balance">{u.fullName}</h1>
      <p className="mt-1 break-all text-fg-muted">{u.email}</p>
      <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[["Status", u.status === "SUSPENDED" ? "Suspended" : u.emailVerified ? "Active" : "Awaiting confirmation"], ["Two-step verification", u.mfaEnabled ? "On" : "Off"], ["Registrations", String(u.counts.registrations)], ["Active sessions", String(u.counts.activeSessions)]].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-surface p-4 shadow-card"><dt className="text-sm text-fg-subtle">{k}</dt><dd className="mt-1 font-semibold">{v}</dd></div>
        ))}
      </dl>
      <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-fg-muted">Roles: {u.roles.map((r, i) => <Badge key={i} className="text-fg">{ROLE_LABEL[r.role] ?? r.role}{r.eventId ? " (one event)" : r.organizationId ? " (one organization)" : ""}</Badge>)}</p>
      <div className="mt-8 max-w-2xl"><UserActions userId={u.id} status={u.status} globalRoles={globalRoles} /></div>
      <section aria-labelledby="activity-heading" className="mt-12">
        <h2 id="activity-heading" className="text-h3 font-semibold">Activity</h2>
        {u.activity.length === 0 ? <p className="mt-3 text-fg-muted">No recorded activity.</p> : (
          <ol className="mt-4 space-y-2">
            {u.activity.map((a) => (
              <li key={a.id} className="rounded-lg bg-surface p-3 text-sm shadow-card">
                <span className="font-medium">{a.action}</span> <span className="text-fg-muted">by {a.by}, <time dateTime={a.createdAt.toISOString()}>{formatDateTime(a.createdAt, "UTC")}</time></span>
                {a.details != null && <code className="mt-1 block break-all text-xs text-fg-subtle">{JSON.stringify(a.details)}</code>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
