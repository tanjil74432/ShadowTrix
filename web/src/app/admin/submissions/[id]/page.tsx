import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { adminFallback, cell, Chip, DataTable, Facts, HistoryList, PageHeading, Section } from "@/components/admin/admin-ui";
import { AdminShell } from "@/components/admin/admin-shell";
import { ApiButton } from "@/components/common/api-button";
import { formatDateTime } from "@/lib/format";
import { AppError } from "@/server/http/errors";
import { requireUser } from "@/server/modules/auth/dal";
import { getAdminSubmission } from "@/server/modules/admin/admin-ops.service";

export const metadata: Metadata = { title: "Submission", robots: { index: false, follow: false } };
const label = (s: string) => s[0] + s.slice(1).toLowerCase().replace("_", " ");
const size = (n: number | bigint) => { const b = Number(n); return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`; };

type Params = Promise<{ id: string }>;

export default function Page({ params }: { params: Params }) {
  return <Suspense fallback={adminFallback}><Gate params={params} /></Suspense>;
}

async function Gate({ params }: { params: Params }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  return <AdminShell section="submissions" returnTo={`/admin/submissions/${id.data}`}><Detail id={id.data} /></AdminShell>;
}

async function Detail({ id }: { id: string }) {
  const actor = await requireUser(`/admin/submissions/${id}`);
  await connection();
  const s = await getAdminSubmission(actor, id).catch((err) => { if (err instanceof AppError && err.status === 404) notFound(); throw err; });
  const link = (u: string | null) => (u ? <a href={u} rel="noopener noreferrer nofollow" target="_blank" className="break-all underline underline-offset-4">{u}</a> : null);
  return (
    <>
      <PageHeading title={s.title} trail={[{ label: "Submissions", href: "/admin/submissions" }, { label: s.title }]} intro={s.description} />
      <div className="flex flex-wrap items-center gap-3">
        <Chip tone={s.status === "DISQUALIFIED" ? "bad" : s.status === "SCORED" ? "good" : "neutral"}>{label(s.status)}</Chip>
        {s.status !== "DISQUALIFIED" && !s.event.resultsPublishedAt && (
          <ApiButton url={`/api/v1/submissions/${s.id}/disqualify`} askReason="Why is this submission disqualified? (at least 5 characters)" confirm="Disqualify this submission? It is removed from scoring and ranking.">Disqualify</ApiButton>
        )}
        {s.event.resultsPublishedAt && <span className="text-sm text-fg-muted">Results are published; unpublish them before disqualifying.</span>}
      </div>
      <Section id="meta" title="Details">
        <Facts items={[
          ["Event", <Link key="e" href={`/admin/events/${s.event.id}`} className="underline underline-offset-4">{s.event.title}</Link>],
          [s.team ? "Team" : "Author", s.team ? <Link key="t" href={`/admin/teams/${s.team.id}`} className="underline underline-offset-4">{s.team.name}</Link> : s.owner.fullName],
          ["Submitted", s.submittedAt ? formatDateTime(s.submittedAt, "UTC") : null], ["Current version", s.currentVersion], ["Repository", link(s.repoUrl)], ["Demo", link(s.demoUrl)],
          ["Other links", s.extraLinks.length ? <ul key="x">{s.extraLinks.map((u) => <li key={u}>{link(u)}</li>)}</ul> : null],
          ["Result", s.result ? `Rank ${s.result.rank ?? "unranked"}, score ${Number(s.result.finalScore)}${s.result.publishedAt ? " (published)" : " (not published)"}` : "No result yet"],
        ]} />
      </Section>
      <Section id="files" title={`Files (${s.files.length})`}>
        {s.files.length === 0 ? <p className="text-fg-muted">No files.</p> : (
          <DataTable caption="Submission files" columns={["File", "Type", "Size", "Uploaded", "Download"]} minWidth="40rem">
            {s.files.map((f) => (
              <tr key={f.id}>
                <th scope="row" className={`${cell} font-medium`}>{f.originalName}</th><td className={cell}>{f.mimeType}</td><td className={cell}>{size(f.sizeBytes)}</td><td className={cell}>{formatDateTime(f.createdAt, "UTC")}</td>
                {/* the existing authorized endpoint: it checks the session and permission on every request and answers with a 60-second signed link (or the bytes in local mode) */}
                <td className={cell}><a href={`/api/v1/submissions/${s.id}/files/${f.id}`} className="underline underline-offset-4" download>Download</a></td>
              </tr>
            ))}
          </DataTable>
        )}
        <p className="mt-2 text-sm text-fg-subtle">Stored files are immutable once attached. Storage locations are never shown.</p>
      </Section>
      <Section id="judging" title="Judging status">
        {s.judging.judges.length === 0 ? <p className="text-fg-muted">No judges are assigned to this event.</p> : (
          <ul className="space-y-1 text-sm">{s.judging.judges.map((j) => <li key={j.name + String(j.complete)}>{j.name}: {j.complete ? "scorecard complete" : "not finished"}</li>)}</ul>
        )}
        <p className="mt-2 text-sm"><Link href={`/admin/judging/${s.event.id}`} className="underline underline-offset-4">Judging progress for this event</Link></p>
      </Section>
      <Section id="versions" title="Version history">
        {s.versions.length === 0 ? <p className="text-fg-muted">No versions yet.</p> : <ul className="space-y-1 text-sm">{s.versions.map((v) => <li key={v.version}>Version {v.version} by {v.createdBy?.fullName ?? "unknown"} on {formatDateTime(v.createdAt, "UTC")}</li>)}</ul>}
      </Section>
      <Section id="hist" title="Audit history"><HistoryList items={s.history} /></Section>
    </>
  );
}
