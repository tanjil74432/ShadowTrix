import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { adminFallback, cell, Chip, DataTable, Facts, HistoryList, PageHeading, Section } from "@/components/admin/admin-ui";
import { AdminShell } from "@/components/admin/admin-shell";
import { formatDateTime } from "@/lib/format";
import { AppError } from "@/server/http/errors";
import { requireUser } from "@/server/modules/auth/dal";
import { getAdminTeam } from "@/server/modules/admin/admin-ops.service";

export const metadata: Metadata = { title: "Team", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

export default function Page({ params }: { params: Params }) {
  return <Suspense fallback={adminFallback}><Gate params={params} /></Suspense>;
}

async function Gate({ params }: { params: Params }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  return <AdminShell section="teams" returnTo={`/admin/teams/${id.data}`}><Detail id={id.data} /></AdminShell>;
}

async function Detail({ id }: { id: string }) {
  const actor = await requireUser(`/admin/teams/${id}`);
  await connection();
  const t = await getAdminTeam(actor, id).catch((err) => { if (err instanceof AppError && err.status === 404) notFound(); throw err; });
  return (
    <>
      <PageHeading title={t.name} trail={[{ label: "Teams", href: "/admin/teams" }, { label: t.name }]} intro={t.description ?? undefined} />
      <Facts items={[
        ["Event", <Link key="e" href={`/admin/events/${t.event.id}`} className="underline underline-offset-4">{t.event.title}</Link>], ["Status", <Chip key="s" tone={t.status === "ACTIVE" ? "good" : "neutral"}>{t.status === "ACTIVE" ? "Active" : "Disbanded"}</Chip>],
        ["Leader", <Link key="l" href={`/admin/users/${t.leader.id}`} className="underline underline-offset-4">{t.leader.fullName}</Link>], ["Created", formatDateTime(t.createdAt, "UTC")],
        ["Registration", t.registrations[0]?.status.toLowerCase() ?? "none"],
        ["Submission", t.submission ? <Link key="sub" href={`/admin/submissions/${t.submission.id}`} className="underline underline-offset-4">{t.submission.title} ({t.submission.status.replace("_", " ").toLowerCase()})</Link> : "none"],
      ]} />
      <Section id="members" title={`Members (${t.members.length})`}>
        <DataTable caption="Team members" columns={["Name", "Role", "Joined"]} minWidth="28rem">
          {t.members.map((m) => (
            <tr key={m.user.id}><th scope="row" className={`${cell} font-medium`}><Link href={`/admin/users/${m.user.id}`} className="underline underline-offset-4">{m.user.fullName}</Link></th><td className={cell}>{m.role === "LEADER" ? "Leader" : "Member"}</td><td className={cell}>{formatDateTime(m.joinedAt, "UTC")}</td></tr>
          ))}
        </DataTable>
        <p className="mt-2 text-sm text-fg-subtle">Email addresses are not shown here. Open a member&apos;s account to see their details.</p>
      </Section>
      <Section id="inv" title="Invitations">
        {t.invitations.length === 0 ? <p className="text-fg-muted">No invitations.</p> : (
          <DataTable caption="Team invitations" columns={["Invitee (masked)", "Status", "Sent", "Expires"]} minWidth="32rem">
            {t.invitations.map((i) => (
              <tr key={i.id}><td className={cell}>{i.inviteeEmail}</td><td className={cell}>{i.status.toLowerCase()}</td><td className={cell}>{formatDateTime(i.createdAt, "UTC")}</td><td className={cell}>{formatDateTime(i.expiresAt, "UTC")}</td></tr>
            ))}
          </DataTable>
        )}
      </Section>
      <Section id="hist" title="Participation history">
        {t.memberHistory.length === 0 ? <p className="text-fg-muted">The members have no other teams.</p> : (
          <ul className="list-disc pl-5 text-sm text-fg-muted">{t.memberHistory.map((h) => <li key={h.id}><Link href={`/admin/teams/${h.id}`} className="underline underline-offset-4">{h.name}</Link> in {h.event}</li>)}</ul>
        )}
      </Section>
      <Section id="act" title="Activity"><HistoryList items={t.activity} /></Section>
    </>
  );
}
