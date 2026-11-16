import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { ProtectedArea } from "@/components/auth/protected-area";
import { ScorecardForm } from "@/components/judging/scorecard-form";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/modules/auth/dal";
import { getScorecard } from "@/server/modules/judging/judging.service";

export const metadata: Metadata = { title: "Score a project", robots: { index: false, follow: false } };

type Params = Promise<{ submissionId: string }>;

export default function ScorePage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<Container className="py-14"><Skeleton className="h-40 w-full" /></Container>}>
      <Gate params={params} />
    </Suspense>
  );
}

async function Gate({ params }: { params: Params }) {
  const id = z.uuid().safeParse((await params).submissionId);
  if (!id.success) notFound();
  return (
    <ProtectedArea anyRole="JUDGE" returnTo={`/judge/submissions/${id.data}`} area="this project">
      <Container className="max-w-3xl py-14 sm:py-20">
        <Score id={id.data} />
      </Container>
    </ProtectedArea>
  );
}

async function Score({ id }: { id: string }) {
  const user = await requireUser(`/judge/submissions/${id}`);
  await connection();
  let card;
  try {
    card = await getScorecard(user, id);
  } catch (e) {
    if ((e as { status?: number }).status === 403) {
      return <p role="status" className="text-fg-muted">You took part in this project, so you cannot judge it.</p>;
    }
    notFound();
  }
  const s = card.submission;
  return (
    <>
      <p className="text-sm"><Link href={`/judge/events/${s.eventId}`} className="underline underline-offset-4 text-fg-muted">Projects to score</Link></p>
      <h1 className="mt-4 text-h1 font-semibold text-balance">{s.title}</h1>
      <section aria-labelledby="project-heading" className="mt-6 space-y-4">
        <h2 id="project-heading" className="text-h3 font-semibold">The project</h2>
        <p className="whitespace-pre-line text-fg-muted text-pretty">{s.description}</p>
        <ul className="space-y-1 text-sm">
          {[s.repoUrl, s.demoUrl, ...s.extraLinks].filter(Boolean).map((u) => (
            <li key={u as string}><a href={u as string} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline underline-offset-4">{u}</a></li>
          ))}
        </ul>
        {s.files.length > 0 && (
          <ul aria-label="Files" className="space-y-1 text-sm">
            {s.files.map((f) => <li key={f.id}><a href={`/api/v1/submissions/${s.id}/files/${f.id}`} className="underline underline-offset-4">{f.originalName}</a></li>)}
          </ul>
        )}
      </section>
      <section aria-labelledby="score-heading" className="mt-10">
        <h2 id="score-heading" className="text-h3 font-semibold">Your scorecard</h2>
        <div className="mt-4"><ScorecardForm submissionId={s.id} criteria={card.criteria} scores={card.scores} finalized={card.finalized} /></div>
      </section>
    </>
  );
}
