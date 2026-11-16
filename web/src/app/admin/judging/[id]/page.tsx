import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { adminFallback, cell, DataTable, Facts, HistoryList, PageHeading, Section } from "@/components/admin/admin-ui";
import { AdminShell } from "@/components/admin/admin-shell";
import { formatDateTime } from "@/lib/format";
import { AppError } from "@/server/http/errors";
import { requireUser } from "@/server/modules/auth/dal";
import { getJudgingEvent } from "@/server/modules/admin/admin-ops.service";

export const metadata: Metadata = { title: "Judging progress", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

export default function Page({ params }: { params: Params }) {
  return <Suspense fallback={adminFallback}><Gate params={params} /></Suspense>;
}

async function Gate({ params }: { params: Params }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  return <AdminShell section="judging" returnTo={`/admin/judging/${id.data}`}><Detail id={id.data} /></AdminShell>;
}

async function Detail({ id }: { id: string }) {
  const actor = await requireUser(`/admin/judging/${id}`);
  await connection();
  const j = await getJudgingEvent(actor, id).catch((err) => { if (err instanceof AppError && err.status === 404) notFound(); throw err; });
  const when = (d: Date | null) => (d ? formatDateTime(d, "UTC") : null);
  return (
    <>
      <PageHeading title={j.event.title} trail={[{ label: "Judging", href: "/admin/judging" }, { label: j.event.title }]} intro="Read-only progress. Scores are never changed from here: judges own their evaluations, and reopening a scorecard needs a reason and is audited." />
      <Facts items={[["Judging starts", when(j.event.judgingStartsAt)], ["Judging ends", when(j.event.judgingEndsAt)], ["Results", j.event.resultsPublishedAt ? `Published ${when(j.event.resultsPublishedAt)}` : "Not published"], ["Event", <Link key="e" href={`/admin/events/${j.event.id}`} className="underline underline-offset-4">Manage event</Link>]]} />
      <Section id="judges" title="Judge allocation">
        {j.judges.length === 0 ? <p className="text-fg-muted">No judges are assigned.</p> : (
          <DataTable caption="Judges and completed scorecards" columns={["Judge", "Completed scorecards", "Total submissions"]} minWidth="30rem">
            {j.judges.map((x) => <tr key={x.id}><th scope="row" className={`${cell} font-medium`}><Link href={`/admin/users/${x.id}`} className="underline underline-offset-4">{x.name}</Link></th><td className={cell}>{x.completed}</td><td className={cell}>{x.total}</td></tr>)}
          </DataTable>
        )}
      </Section>
      <Section id="criteria" title="Criteria and weights">
        {j.criteria.length === 0 ? <p className="text-fg-muted">No criteria defined, so nothing can be scored.</p> : (
          <DataTable caption="Judging criteria" columns={["Criterion", "Maximum score", "Weight"]} minWidth="28rem">
            {j.criteria.map((c) => <tr key={c.id}><th scope="row" className={`${cell} font-medium`}>{c.name}</th><td className={cell}>{c.maxScore}</td><td className={cell}>{c.weight}</td></tr>)}
          </DataTable>
        )}
      </Section>
      <Section id="incomplete" title={`Incomplete judging (${j.incomplete.length})`}>
        {j.incomplete.length === 0 ? <p className="text-fg-muted">Every judge has finished every submission.</p> : (
          <DataTable caption="Submissions with unfinished scorecards" columns={["Submission", "Team", "Judges still to finish"]} minWidth="36rem">
            {j.incomplete.map((s) => <tr key={s.id}><th scope="row" className={`${cell} font-medium`}><Link href={`/admin/submissions/${s.id}`} className="underline underline-offset-4">{s.title}</Link></th><td className={cell}>{s.team ?? "Individual"}</td><td className={cell}>{s.missing.join(", ")}</td></tr>)}
          </DataTable>
        )}
      </Section>
      <Section id="hist" title="Judging audit history"><HistoryList items={j.history} /></Section>
    </>
  );
}
