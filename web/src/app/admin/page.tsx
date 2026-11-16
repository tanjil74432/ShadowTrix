import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
const fallback = <Container className="py-14"><Skeleton className="h-96 w-full" /></Container>;
import { listAuditLog, auditQuerySchema } from "@/server/modules/admin/admin-management.service";
import { getAnalytics } from "@/server/modules/analytics/analytics.service";

export const metadata: Metadata = { title: "Administration", robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <Suspense fallback={fallback}>
      <AdminShell section="overview" returnTo="/admin"><Overview /></AdminShell>
    </Suspense>
  );
}

async function Overview() {
  const actor = await requireUser("/admin");
  await connection();
  const [a, security] = await Promise.all([getAnalytics(actor, {}), listAuditLog(actor, auditQuerySchema.parse({ view: "security", pageSize: 5 }))]);
  const cards: [string, number | string][] = [
    ["Users", a.users.total], ["Published events", a.events.byStatus.PUBLISHED ?? 0], ["Draft events", a.events.byStatus.DRAFT ?? 0],
    [`Registrations (${a.range.days} days)`, a.registrations.inRange.CONFIRMED + a.registrations.inRange.WAITLISTED + a.registrations.inRange.PENDING],
    ["Active teams", a.teams.active], ["Judging completion", a.judging.completionPercent === null ? "n/a" : `${a.judging.completionPercent}%`],
  ];
  return (
    <>
      <h1 className="text-h1 font-semibold">Administration</h1>
      <p className="mt-2 max-w-2xl text-fg-muted">Figures come straight from the database. See Analytics for a date range and breakdowns.</p>
      <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([label, v]) => (
          <div key={label} className="rounded-lg bg-surface p-5 shadow-card"><dt className="text-sm text-fg-subtle">{label}</dt><dd className="mt-1 text-h2 font-semibold">{v}</dd></div>
        ))}
      </dl>
      <section aria-labelledby="recent-heading" className="mt-12">
        <div className="flex items-baseline justify-between gap-4"><h2 id="recent-heading" className="text-h3 font-semibold">Recent security events</h2><Link href="/admin/audit?view=security" className="text-sm underline underline-offset-4">All security events</Link></div>
        {security.items.length === 0 ? <p className="mt-4 text-fg-muted">Nothing recorded yet.</p> : (
          <ul className="mt-4 space-y-2">
            {security.items.map((i) => (
              <li key={i.id} className="rounded-lg bg-surface p-3 text-sm shadow-card"><span className="font-medium">{i.action}</span> <span className="text-fg-muted">by {i.actor?.fullName ?? "system"} on <time dateTime={i.createdAt.toISOString()}>{formatDateTime(i.createdAt, "UTC")}</time></span></li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
