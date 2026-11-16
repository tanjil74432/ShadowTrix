import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { adminFallback, Chip, HistoryList, PageHeading, Section } from "@/components/admin/admin-ui";
import { AdminShell } from "@/components/admin/admin-shell";
import { requireUser } from "@/server/modules/auth/dal";
import { getAdminOverview } from "@/server/modules/admin/admin-ops.service";

export const metadata: Metadata = { title: "Administration", robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <Suspense fallback={adminFallback}>
      <AdminShell section="overview" returnTo="/admin"><Overview /></AdminShell>
    </Suspense>
  );
}

async function Overview() {
  const actor = await requireUser("/admin");
  await connection();
  const o = await getAdminOverview(actor);
  const groups: { title: string; href: string; items: [string, number][] }[] = [
    { title: "Users", href: "/admin/users", items: [["Registered", o.users.total], ["Verified", o.users.verified], ["Unverified", o.users.unverified], ["Active", o.users.active], ["Suspended", o.users.suspended]] },
    { title: "Events", href: "/admin/events", items: [["Total", o.events.total], ["Draft", o.events.draft], ["Published", o.events.published], ["Ongoing", o.events.ongoing], ["Completed", o.events.completed], ["Cancelled", o.events.cancelled], ["Awaiting approval", o.events.awaitingReview]] },
    { title: "Organizations", href: "/admin/organizations", items: [["Total", o.organizations.total], ["Not verified", o.organizations.unverified]] },
    { title: "Participation", href: "/admin/teams", items: [["Active teams", o.teams], ["Submissions", o.submissions], ["Awaiting judging", o.pendingJudging]] },
    { title: "Outcomes", href: "/admin/results", items: [["Events with published results", o.publishedResults], ["Certificates issued", o.certificates.issued], ["Certificates revoked", o.certificates.revoked]] },
  ];
  return (
    <>
      <PageHeading title="Administration" intro="Every figure is counted from the database when this page loads." trail={[{ label: "Overview" }]} />
      <section aria-labelledby="alerts-h">
        <h2 id="alerts-h" className="text-h3 font-semibold">Needs attention</h2>
        {o.alerts.length === 0 ? <p className="mt-3 text-fg-muted">Nothing needs attention right now.</p> : (
          <ul className="mt-3 space-y-2">
            {o.alerts.map((a) => (
              <li key={a.text} className="flex flex-wrap items-center gap-3 rounded-lg bg-surface p-3 text-sm shadow-card">
                <Chip tone={a.level === "warning" ? "warn" : "neutral"}>{a.level === "warning" ? "Warning" : "Pending"}</Chip>
                <span>{a.text}</span>
                {a.href && <Link href={a.href} className="underline underline-offset-4">Open</Link>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        {groups.map((g) => (
          <section key={g.title} aria-labelledby={`g-${g.title}`} className="rounded-lg bg-surface p-5 shadow-card">
            <h2 id={`g-${g.title}`} className="flex items-baseline justify-between text-h3 font-semibold">{g.title}<Link href={g.href} className="text-sm font-normal underline underline-offset-4">Manage</Link></h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
              {g.items.map(([k, v]) => <div key={k}><dt className="text-sm text-fg-subtle">{k}</dt><dd className="text-h3 font-semibold">{v}</dd></div>)}
            </dl>
          </section>
        ))}
      </div>
      <Section id="recent-h" title="Recent platform activity">
        <HistoryList items={o.recent.map((r) => ({ id: r.id, action: r.action, at: r.at, by: r.by }))} />
        <p className="mt-3 text-sm"><Link href="/admin/audit" className="underline underline-offset-4">Open the audit log</Link> · <Link href="/admin/audit?view=security" className="underline underline-offset-4">Security events</Link></p>
      </Section>
    </>
  );
}
