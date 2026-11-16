import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { adminFallback, cell, Chip, DataTable, HistoryList, PageHeading, Section } from "@/components/admin/admin-ui";
import { AdminShell } from "@/components/admin/admin-shell";
import { ApiButton } from "@/components/common/api-button";
import { formatDateTime } from "@/lib/format";
import { AppError } from "@/server/http/errors";
import { requireUser } from "@/server/modules/auth/dal";
import { getAdminResults } from "@/server/modules/admin/admin-ops.service";

export const metadata: Metadata = { title: "Event results", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

export default function Page({ params }: { params: Params }) {
  return <Suspense fallback={adminFallback}><Gate params={params} /></Suspense>;
}

async function Gate({ params }: { params: Params }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  return <AdminShell section="results" returnTo={`/admin/results/${id.data}`}><Detail id={id.data} /></AdminShell>;
}

async function Detail({ id }: { id: string }) {
  const actor = await requireUser(`/admin/results/${id}`);
  await connection();
  const r = await getAdminResults(actor, id).catch((err) => { if (err instanceof AppError && err.status === 404) notFound(); throw err; });
  const published = !!r.event.resultsPublishedAt;
  return (
    <>
      <PageHeading title={r.event.title} trail={[{ label: "Results", href: "/admin/results" }, { label: r.event.title }]} intro="Rankings as computed from the judges' finalized scores. Nothing here edits a score." />
      <div className="flex flex-wrap items-center gap-3">
        {published ? <Chip tone="good">Published {formatDateTime(r.event.resultsPublishedAt!, "UTC")}</Chip> : <Chip tone="warn">Not published</Chip>}
        {published ? (
          <ApiButton url={`/api/v1/events/${r.event.id}/results/unpublish`} askReason="Why are the results being unpublished? (at least 5 characters)" confirm="Unpublish these results? Participants stop seeing them.">Unpublish results</ApiButton>
        ) : (
          <ApiButton url={`/api/v1/events/${r.event.id}/results/publish`} variant="primary" confirm="Publish these results? Participants can see them immediately. The server refuses if any scorecard is unfinished.">Publish results</ApiButton>
        )}
        <Link href={`/admin/judging/${r.event.id}`} className="text-sm underline underline-offset-4">Judging progress</Link>
      </div>
      <Section id="rank" title="Rankings">
        {r.rows.length === 0 ? <p className="text-fg-muted">No results computed.</p> : (
          <DataTable caption="Rankings" columns={["Rank", "Submission", "Team or author", "Weighted score", "Award", "Notes"]} minWidth="46rem">
            {r.rows.map((x) => (
              <tr key={x.id}>
                <td className={cell}>{x.rank ?? "Unranked"}</td>
                <th scope="row" className={`${cell} font-medium`}><Link href={`/admin/submissions/${x.submissionId}`} className="underline underline-offset-4">{x.title}</Link></th>
                <td className={cell}>{x.by}</td><td className={cell}>{x.finalScore}</td><td className={cell}>{x.award === "NONE" ? "none" : x.award.toLowerCase().replace("_", " ")}</td>
                <td className={cell}>{x.tied ? <Chip tone="warn">Tied at rank {x.rank}</Chip> : ""}</td>
              </tr>
            ))}
          </DataTable>
        )}
        <p className="mt-2 text-sm text-fg-subtle">Tied entries share a rank. The final score is the weighted average of the judges&apos; finalized criterion scores.</p>
      </Section>
      <Section id="hist" title="Publication history"><HistoryList items={r.history} /></Section>
    </>
  );
}
