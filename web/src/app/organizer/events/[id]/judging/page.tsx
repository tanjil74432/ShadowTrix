import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { ProtectedArea } from "@/components/auth/protected-area";
import { ApiButton } from "@/components/common/api-button";
import { AssignJudgeForm } from "@/components/judging/assign-judge-form";
import { CriterionForm } from "@/components/judging/criterion-form";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/modules/auth/dal";
import { loadManagedEvent } from "@/server/modules/events/events.service";
import { listCriteria, listJudges } from "@/server/modules/judging/judging.service";
import { listEventSubmissions } from "@/server/modules/submissions/submissions.service";

export const metadata: Metadata = { title: "Judging setup", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

export default function JudgingSetupPage({ params }: { params: Params }) {
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
    <ProtectedArea anyRole="ORGANIZER" returnTo={`/organizer/events/${id.data}/judging`} area="this event">
      <Container className="py-14 sm:py-20"><Setup id={id.data} /></Container>
    </ProtectedArea>
  );
}

async function Setup({ id }: { id: string }) {
  const user = await requireUser(`/organizer/events/${id}/judging`);
  await connection();
  let event;
  try {
    event = await loadManagedEvent(user, id);
  } catch {
    notFound();
  }
  const [criteria, judges, submissions] = await Promise.all([listCriteria(user, id), listJudges(user, id), listEventSubmissions(user, id)]);
  const locked = !!event.resultsPublishedAt;
  const weightSum = criteria.reduce((n, c) => n + c.weight, 0);
  return (
    <>
      <p className="text-sm"><Link href={`/organizer/events/${id}`} className="underline underline-offset-4 text-fg-muted">{event.title}</Link></p>
      <h1 className="mt-4 text-h1 font-semibold">Judging setup</h1>
      <p className="mt-2 max-w-3xl text-fg-muted">
        Each judge scores every criterion for every submitted project. A scorecard becomes a percentage: each score divided by its maximum, weighted, out of 100. The final score is the average of all judges. Criteria cannot change once scoring has started.
      </p>

      <section aria-labelledby="criteria-heading" className="mt-10">
        <h2 id="criteria-heading" className="text-h3 font-semibold">Criteria</h2>
        {criteria.length === 0 ? (
          <EmptyState className="mt-4" title="No criteria yet" description="Add at least one criterion before judges can score." />
        ) : (
          <ul className="mt-4 space-y-2">
            {criteria.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-4 shadow-card">
                <span><span className="font-medium">{c.name}</span> <span className="text-sm text-fg-muted">max {c.maxScore}, weight {c.weight} ({Math.round((c.weight / weightSum) * 1000) / 10}% of the total)</span>{c.description && <span className="block text-sm text-fg-subtle">{c.description}</span>}</span>
                {!locked && <ApiButton url={`/api/v1/events/${id}/criteria/${c.id}`} method="DELETE" variant="ghost" confirm={`Delete the criterion ${c.name}?`}>Delete</ApiButton>}
              </li>
            ))}
          </ul>
        )}
        {!locked && <div className="mt-6 max-w-3xl"><CriterionForm eventId={id} /></div>}
      </section>

      <section aria-labelledby="judges-heading" className="mt-12">
        <h2 id="judges-heading" className="text-h3 font-semibold">Judges</h2>
        {judges.length === 0 ? (
          <EmptyState className="mt-4" title="No judges assigned" description="Assign people who have a confirmed account." />
        ) : (
          <ul className="mt-4 space-y-2">
            {judges.map((j) => (
              <li key={j.judgeId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-4 shadow-card">
                <span><span className="font-medium">{j.fullName}</span> <span className="text-sm text-fg-muted break-all">{j.email}</span><span className="block text-sm text-fg-subtle">{j.finalized} of {j.total} scorecards finalized</span></span>
                <ApiButton url={`/api/v1/events/${id}/judges/${j.judgeId}`} method="DELETE" variant="ghost" confirm={`Remove ${j.fullName} as a judge?`}>Remove</ApiButton>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-6 max-w-xl"><AssignJudgeForm eventId={id} /></div>
      </section>

      <section aria-labelledby="subs-heading" className="mt-12">
        <h2 id="subs-heading" className="text-h3 font-semibold">Submissions ({submissions.length})</h2>
        {submissions.length === 0 ? (
          <EmptyState className="mt-4" title="No submissions yet" description="Submissions appear here as participants save and submit them." />
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg shadow-card" tabIndex={0} role="region" aria-label="Submissions">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b border-border-strong text-fg-subtle"><tr>
                <th scope="col" className="px-4 py-3 font-medium">Project</th><th scope="col" className="px-4 py-3 font-medium">By</th><th scope="col" className="px-4 py-3 font-medium">Status</th><th scope="col" className="px-4 py-3 font-medium">Version</th>
              </tr></thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <th scope="row" className="px-4 py-3 font-medium"><Link href={`/organizer/events/${id}/submissions/${s.id}`} className="underline underline-offset-4">{s.title}</Link></th>
                    <td className="px-4 py-3">{s.team?.name ?? s.owner.fullName}</td>
                    <td className="px-4 py-3"><Badge className="text-fg">{s.status.replace("_", " ").toLowerCase()}</Badge></td>
                    <td className="px-4 py-3">{s.currentVersion}</td>
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
