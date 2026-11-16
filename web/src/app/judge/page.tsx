import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProtectedArea } from "@/components/auth/protected-area";
import { AreaNav } from "@/components/dashboard/area-nav";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
import { listJudgedEvents } from "@/server/modules/judging/judging.service";

export const metadata: Metadata = { title: "Judge area", robots: { index: false, follow: false } };

export default function JudgePage() {
  return (
    <Suspense fallback={<Container className="py-14"><Skeleton className="h-40 w-full" /></Container>}>
      <ProtectedArea anyRole="JUDGE" returnTo="/judge" area="the judge area">
        <Container className="py-14 sm:py-20">
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <JudgeContent />
          </Suspense>
        </Container>
      </ProtectedArea>
    </Suspense>
  );
}

async function JudgeContent() {
  const user = await requireUser("/judge");
  await connection();
  const events = await listJudgedEvents(user);
  const now = new Date();
  return (
    <>
      <AreaNav user={user} current="judge" />
      <h1 className="text-h1 font-semibold">Judge area</h1>
      <p className="mt-2 max-w-2xl text-fg-muted">Events you are assigned to judge. Projects are shown without the names of the people behind them.</p>
      {events.length === 0 ? (
        <EmptyState className="mt-8" title="You are not assigned to any event yet" description="An organizer assigns judges to their events. You will see the event here once you are assigned." />
      ) : (
        <ul className="mt-8 space-y-3">
          {events.map((e) => {
            const opens = e.judgingStartsAt ?? e.submissionDeadline ?? e.endsAt;
            return (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-4 shadow-card">
                <span className="min-w-0 flex-1">
                  <Link href={`/judge/events/${e.id}`} className="font-medium underline underline-offset-4">{e.title}</Link>
                  <span className="block text-sm text-fg-muted">
                    {e.finalized} of {e.total} scorecards finalized.{" "}
                    {e.resultsPublishedAt ? "Results are published." : now < opens ? `Judging opens ${formatDateTime(opens, "UTC")}.` : "Judging is open."}
                  </span>
                  <Progress className="mt-3 max-w-md" value={e.finalized} max={e.total} label={`Scorecards finalized for ${e.title}`} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
