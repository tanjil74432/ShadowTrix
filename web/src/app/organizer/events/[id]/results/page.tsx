import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { ProtectedArea } from "@/components/auth/protected-area";
import { TemplateForm } from "@/components/certificates/template-form";
import { ApiButton } from "@/components/common/api-button";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
import { getTemplate, listEventCertificates } from "@/server/modules/certificates/certificates.service";
import { loadManagedEvent } from "@/server/modules/events/events.service";
import { getDraftStandings } from "@/server/modules/results/results.service";

export const metadata: Metadata = { title: "Results and certificates", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

export default function ResultsManagePage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<Container className="py-14"><Skeleton className="h-96 w-full" /></Container>}>
      <Gate params={params} />
    </Suspense>
  );
}

async function Gate({ params }: { params: Params }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  return (
    <ProtectedArea anyRole="ORGANIZER" returnTo={`/organizer/events/${id.data}/results`} area="this event">
      <Container className="py-14 sm:py-20"><Manage id={id.data} /></Container>
    </ProtectedArea>
  );
}

const AWARD: Record<string, string> = { WINNER: "Winner", RUNNER_UP: "Runner-up", FINALIST: "Finalist", NONE: "" };

async function Manage({ id }: { id: string }) {
  const user = await requireUser(`/organizer/events/${id}/results`);
  await connection();
  let event;
  try {
    event = await loadManagedEvent(user, id);
  } catch {
    notFound();
  }
  const [standings, certs, tPart, tFin, tWin] = await Promise.all([
    getDraftStandings(user, id), listEventCertificates(user, id),
    getTemplate(user, id, "PARTICIPATION"), getTemplate(user, id, "FINALIST"), getTemplate(user, id, "WINNER"),
  ]);
  return (
    <>
      <p className="text-sm"><Link href={`/organizer/events/${id}`} className="underline underline-offset-4 text-fg-muted">{event.title}</Link></p>
      <h1 className="mt-4 text-h1 font-semibold">Results and certificates</h1>

      <section aria-labelledby="standings-heading" className="mt-10">
        <h2 id="standings-heading" className="text-h3 font-semibold">Standings</h2>
        <p className="mt-2 text-fg-muted" role="status">
          {standings.published
            ? `Published ${formatDateTime(standings.publishedAt!, "UTC")}.`
            : standings.complete
              ? "Every submission has finalized scorecards from every judge. The results can be published."
              : `Not ready to publish: ${standings.criteria === 0 ? "no criteria are defined. " : ""}${standings.judges === 0 ? "no judges are assigned. " : ""}${standings.eligible === 0 ? "there are no submitted projects. " : ""}${standings.missing.length > 0 ? `${standings.missing.length} submission(s) still need scorecards.` : ""}`}
        </p>
        {standings.missing.length > 0 && (
          <ul className="mt-3 list-disc pl-6 text-sm text-fg-muted">
            {standings.missing.map((m) => <li key={m.submissionId}>{m.title}: waiting for {m.judgesMissing} judge(s)</li>)}
          </ul>
        )}
        {standings.rows.length > 0 && (
          <div className="mt-6 overflow-x-auto rounded-lg shadow-card" tabIndex={0} role="region" aria-label="Standings">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="border-b border-border-strong text-fg-subtle"><tr>
                <th scope="col" className="px-4 py-3 font-medium">Rank</th><th scope="col" className="px-4 py-3 font-medium">Project</th><th scope="col" className="px-4 py-3 font-medium">Award</th><th scope="col" className="px-4 py-3 font-medium">Score</th>
              </tr></thead>
              <tbody>
                {standings.rows.map((r) => (
                  <tr key={r.submissionId} className="border-b border-border last:border-0">
                    <th scope="row" className="px-4 py-3 font-medium">{r.tied ? `T-${r.rank}` : r.rank}</th>
                    <td className="px-4 py-3">{r.title}</td>
                    <td className="px-4 py-3">{AWARD[r.award] && <Badge className="text-fg">{AWARD[r.award]}</Badge>}</td>
                    <td className="px-4 py-3">{r.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          {!standings.published && <ApiButton url={`/api/v1/events/${id}/results/recalculate`}>Recalculate draft</ApiButton>}
          {!standings.published && <ApiButton url={`/api/v1/events/${id}/results/publish`} variant="primary" confirm="Publish the results? They become public.">Publish results</ApiButton>}
          {standings.published && <ApiButton url={`/api/v1/events/${id}/results/unpublish`} askReason="Why are you withdrawing the published results?">Unpublish results</ApiButton>}
          {standings.published && event.slug && <Link href={`/events/${event.slug}/results`} className="self-center text-sm font-medium underline underline-offset-4">Public results page</Link>}
        </div>
      </section>

      <section aria-labelledby="certs-heading" className="mt-12">
        <h2 id="certs-heading" className="text-h3 font-semibold">Certificates</h2>
        <p className="mt-2 max-w-3xl text-fg-muted">Issued only from published results: winners, finalists (runner-up and ranks 3 to 5) and participation for everyone else who submitted. Team results go to every confirmed member. Safe to repeat.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {([["PARTICIPATION", tPart], ["FINALIST", tFin], ["WINNER", tWin]] as const).map(([type, t]) => (
            <TemplateForm key={type} eventId={id} type={type} heading={t.heading} body={t.body} signatoryName={t.signatoryName ?? ""} signatoryTitle={t.signatoryTitle ?? ""} isDefault={t.isDefault} />
          ))}
        </div>
        <div className="mt-6"><ApiButton url={`/api/v1/events/${id}/certificates/issue`} variant="primary" confirm="Issue certificates to everyone who earned one?">Issue certificates</ApiButton></div>
        {certs.length > 0 && (
          <div className="mt-6 overflow-x-auto rounded-lg shadow-card" tabIndex={0} role="region" aria-label="Issued certificates">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b border-border-strong text-fg-subtle"><tr>
                <th scope="col" className="px-4 py-3 font-medium">Recipient</th><th scope="col" className="px-4 py-3 font-medium">Type</th><th scope="col" className="px-4 py-3 font-medium">Code</th><th scope="col" className="px-4 py-3 font-medium">Issued</th><th scope="col" className="px-4 py-3 font-medium">Status</th>
              </tr></thead>
              <tbody>
                {certs.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <th scope="row" className="px-4 py-3 font-medium">{c.recipientName}</th>
                    <td className="px-4 py-3">{c.type[0] + c.type.slice(1).toLowerCase()}</td>
                    <td className="px-4 py-3"><Link href={`/verify/certificate/${c.publicCode}`} className="underline underline-offset-4">{c.publicCode}</Link></td>
                    <td className="px-4 py-3"><time dateTime={c.issuedAt.toISOString()}>{formatDateTime(c.issuedAt, "UTC")}</time> by {c.issuedBy?.fullName ?? "-"}</td>
                    <td className="px-4 py-3">{c.revokedAt ? <span>Revoked: {c.revokedReason}</span> : <ApiButton url={`/api/v1/certificates/${c.id}/revoke`} askReason="Why is this certificate being revoked?" variant="ghost">Revoke</ApiButton>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
