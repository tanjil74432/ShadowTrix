import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { getCurrentUser } from "@/server/modules/auth/dal";
import { listMyCertificates } from "@/server/modules/certificates/certificates.service";
import { getMyResult, getPublicResults } from "@/server/modules/results/results.service";

export const metadata: Metadata = { title: "Results" };

type Params = Promise<{ slug: string }>;

export default function ResultsPage({ params }: { params: Params }) {
  return (
    <Container className="py-14 sm:py-20">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Results params={params} />
      </Suspense>
    </Container>
  );
}

const AWARD: Record<string, string> = { WINNER: "Winner", RUNNER_UP: "Runner-up", FINALIST: "Finalist", NONE: "" };

async function Results({ params }: { params: Params }) {
  await connection();
  const { slug } = await params;
  const data = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) ? await getPublicResults(slug) : null;
  if (!data) notFound(); // unpublished results look exactly like a page that does not exist
  const user = await getCurrentUser();
  const mine = user ? await getMyResult(user, data.event.id) : null;
  const myCertificates = user ? (await listMyCertificates(user.id)).filter((c) => c.event.slug === data.event.slug && !c.revokedAt) : [];

  return (
    <>
      <title>{`Results: ${data.event.title}`}</title>
      <p className="text-sm"><Link href={`/events/${data.event.slug}`} className="underline underline-offset-4 text-fg-muted">{data.event.title}</Link></p>
      <h1 className="mt-4 text-h1 font-semibold text-balance">Results</h1>
      <p className="mt-2 text-fg-muted">
        Published <time dateTime={data.event.resultsPublishedAt!.toISOString()}>{formatDate(data.event.resultsPublishedAt!, data.event.timezone)}</time>. Scores are the average of every judge&apos;s weighted score, out of 100. Equal scores share a rank.
      </p>

      {mine && (
        <section aria-labelledby="mine-heading" className="mt-10 max-w-3xl space-y-4 rounded-lg bg-surface p-6 shadow-card">
          <h2 id="mine-heading" className="text-h3 font-semibold">Your result</h2>
          <p>
            <strong>{mine.title}</strong>: rank {mine.rank}, score {mine.score}{AWARD[mine.award] ? `, ${AWARD[mine.award]}` : ""}.
          </p>
          {mine.criteria.length > 0 && (
            <ul className="text-sm text-fg-muted">
              {mine.criteria.map((c) => <li key={c.name}>{c.name}: average {c.average}</li>)}
            </ul>
          )}
          {mine.feedback.length > 0 && (
            <div>
              <h3 className="font-medium">Judges&apos; feedback (anonymous)</h3>
              <ul className="mt-2 space-y-2 text-fg-muted">
                {mine.feedback.map((f, i) => <li key={i}><span className="text-fg-subtle">{f.criterion}:</span> {f.text}</li>)}
              </ul>
            </div>
          )}
          {myCertificates.map((c) => (
            <Button key={c.id} asChild variant="secondary"><a href={`/api/v1/certificates/${c.id}/pdf`} download>Download your certificate (PDF)</a></Button>
          ))}
        </section>
      )}

      <div className="mt-10 overflow-x-auto rounded-lg shadow-card" tabIndex={0} role="region" aria-label="Leaderboard">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <caption className="sr-only">Leaderboard of {data.event.title}</caption>
          <thead className="border-b border-border-strong text-fg-subtle">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Rank</th>
              <th scope="col" className="px-4 py-3 font-medium">Team or participant</th>
              <th scope="col" className="px-4 py-3 font-medium">Project</th>
              <th scope="col" className="px-4 py-3 font-medium">Award</th>
              <th scope="col" className="px-4 py-3 font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <th scope="row" className="px-4 py-3 font-medium">{e.tied ? `T-${e.rank}` : e.rank}</th>
                <td className="px-4 py-3">{e.name}</td>
                <td className="px-4 py-3">{e.title}</td>
                <td className="px-4 py-3">{AWARD[e.award] ? <Badge className="text-fg">{AWARD[e.award]}</Badge> : ""}</td>
                <td className="px-4 py-3">{e.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.entries.some((e) => e.tied) && <p className="mt-3 text-sm text-fg-muted">&quot;T&quot; marks a tie: those entries have exactly the same score.</p>}
    </>
  );
}
