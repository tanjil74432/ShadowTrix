import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { ProtectedArea } from "@/components/auth/protected-area";
import { ApiButton } from "@/components/common/api-button";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
import { listScorecardStates } from "@/server/modules/judging/judging.service";
import { getSubmission, listVersions } from "@/server/modules/submissions/submissions.service";

export const metadata: Metadata = { title: "Submission", robots: { index: false, follow: false } };

type Params = Promise<{ id: string; submissionId: string }>;

export default function OrganizerSubmissionPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<Container className="py-14"><Skeleton className="h-96 w-full" /></Container>}>
      <Gate params={params} />
    </Suspense>
  );
}

async function Gate({ params }: { params: Params }) {
  const p = await params;
  const eventId = z.uuid().safeParse(p.id);
  const subId = z.uuid().safeParse(p.submissionId);
  if (!eventId.success || !subId.success) notFound();
  return (
    <ProtectedArea anyRole="ORGANIZER" returnTo={`/organizer/events/${eventId.data}/submissions/${subId.data}`} area="this submission">
      <Container className="max-w-3xl py-14 sm:py-20"><Detail eventId={eventId.data} id={subId.data} /></Container>
    </ProtectedArea>
  );
}

async function Detail({ eventId, id }: { eventId: string; id: string }) {
  const user = await requireUser(`/organizer/events/${eventId}/submissions/${id}`);
  await connection();
  let sub, versions, cards;
  try {
    sub = await getSubmission(user, id);
    if (sub.eventId !== eventId) notFound();
    [versions, cards] = await Promise.all([listVersions(user, id), listScorecardStates(user, id)]);
  } catch {
    notFound();
  }
  return (
    <>
      <p className="text-sm"><Link href={`/organizer/events/${eventId}/judging`} className="underline underline-offset-4 text-fg-muted">Judging setup</Link></p>
      <h1 className="mt-4 text-h1 font-semibold text-balance">{sub.title}</h1>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-fg-muted">By {sub.team?.name ?? "an individual participant"} <Badge className="text-fg">{sub.status.replace("_", " ").toLowerCase()}</Badge> version {sub.currentVersion}</p>
      <p className="mt-6 whitespace-pre-line text-fg-muted text-pretty">{sub.description}</p>
      <ul className="mt-4 space-y-1 text-sm">
        {[sub.repoUrl, sub.demoUrl, ...sub.extraLinks].filter(Boolean).map((u) => <li key={u as string}><a href={u as string} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline underline-offset-4">{u}</a></li>)}
        {sub.files.map((f) => <li key={f.id}><a href={`/api/v1/submissions/${sub.id}/files/${f.id}`} className="underline underline-offset-4">{f.originalName}</a></li>)}
      </ul>

      <section aria-labelledby="cards-heading" className="mt-10">
        <h2 id="cards-heading" className="text-h3 font-semibold">Scorecards</h2>
        {cards.length === 0 ? <p className="mt-3 text-fg-muted">No judges are assigned.</p> : (
          <ul className="mt-4 space-y-2">
            {cards.map((c) => (
              <li key={c.judgeId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-4 shadow-card">
                <span>{c.name}: <span className="text-fg-muted">{c.state === "FINAL" ? "finalized" : c.state === "DRAFT" ? "draft" : "not started"}</span></span>
                {c.state === "FINAL" && <ApiButton url={`/api/v1/submissions/${id}/scorecard/reopen`} body={{ judgeId: c.judgeId }} askReason="Why does this scorecard need to be reopened?" variant="ghost">Reopen</ApiButton>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="versions-heading" className="mt-10">
        <h2 id="versions-heading" className="text-h3 font-semibold">Version history</h2>
        <ol className="mt-4 space-y-2">
          {versions.map((v) => <li key={v.version} className="rounded-lg bg-surface p-3 text-sm shadow-card">Version {v.version}: <span className="font-medium">{(v.snapshot as { title?: string }).title}</span> - <time dateTime={v.createdAt.toISOString()}>{formatDateTime(v.createdAt, "UTC")}</time> by {v.createdBy?.fullName ?? "a former member"}</li>)}
          {versions.length === 0 && <li className="text-fg-muted">Not submitted yet.</li>}
        </ol>
      </section>

      {sub.status !== "DISQUALIFIED" && (
        <section aria-labelledby="dq-heading" className="mt-10">
          <h2 id="dq-heading" className="text-h3 font-semibold">Disqualify</h2>
          <p className="mt-2 text-fg-muted">The submission is excluded from the results. The reason is recorded.</p>
          <div className="mt-3"><ApiButton url={`/api/v1/submissions/${id}/disqualify`} askReason="Reason for disqualification (recorded):" confirm="Disqualify this submission?">Disqualify</ApiButton></div>
        </section>
      )}
    </>
  );
}
