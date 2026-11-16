import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { FileManager } from "@/components/submission/file-manager";
import { SubmissionForm } from "@/components/submission/submission-form";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
import { getPublicEvent } from "@/server/modules/events/events.service";
import { getMyRegistration } from "@/server/modules/events/registrations.service";
import { getMySubmission, listVersions, submissionDeadlineOf } from "@/server/modules/submissions/submissions.service";

export const metadata: Metadata = { title: "Project submission", robots: { index: false, follow: false } };

type Params = Promise<{ slug: string }>;

export default function SubmissionPage({ params }: { params: Params }) {
  return (
    <Container className="max-w-3xl py-14 sm:py-20">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <SubmissionContent params={params} />
      </Suspense>
    </Container>
  );
}

async function SubmissionContent({ params }: { params: Params }) {
  const { slug } = await params;
  const event = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) ? await getPublicEvent(slug) : null;
  if (!event) notFound();
  const user = await requireUser(`/events/${slug}/submission`);
  await connection();
  const now = new Date();
  const reg = await getMyRegistration(user.id, event.id);
  const eligible = reg?.status === "CONFIRMED" && event.status === "PUBLISHED";
  const deadline = submissionDeadlineOf({ submissionDeadline: event.submissionDeadline, endsAt: event.endsAt });
  const submission = eligible ? await getMySubmission(user, event.id) : null;
  const closed = now >= deadline;
  const lockedStatus = submission && ["UNDER_REVIEW", "SCORED", "DISQUALIFIED"].includes(submission.status);
  const locked = closed || !!lockedStatus;
  const versions = submission && submission.status !== "DRAFT" ? await listVersions(user, submission.id) : [];

  return (
    <>
      <p className="text-sm"><Link href={`/events/${event.slug}`} className="underline underline-offset-4 text-fg-muted">{event.title}</Link></p>
      <h1 className="mt-4 text-h1 font-semibold text-balance">Project submission</h1>
      {!eligible ? (
        <p className="mt-6 text-fg-muted" role="status">
          Only people with a confirmed registration{event.registrationMode === "TEAM" ? " (through a registered team)" : ""} can submit a project for this event.{" "}
          <Link href={`/events/${event.slug}`} className="underline underline-offset-4">Back to the event</Link>
        </p>
      ) : (
        <>
          <p className="mt-3 text-fg-muted">
            {event.registrationMode === "TEAM" ? "Everyone in your team shares one submission. " : ""}
            Deadline: <time dateTime={deadline.toISOString()} className="font-medium text-fg">{formatDateTime(deadline, event.timezone)}</time>.{" "}
            {closed ? "The deadline has passed, so the submission can no longer change." : ""}
          </p>
          <p className="mt-3 flex flex-wrap items-center gap-2">
            Status: <Badge className="text-fg">{!submission ? "Not started" : submission.status === "DRAFT" ? "Draft (private)" : submission.status === "SUBMITTED" ? `Submitted (version ${submission.currentVersion})` : submission.status === "UNDER_REVIEW" ? "Under review" : submission.status === "SCORED" ? "Scored" : "Disqualified"}</Badge>
          </p>
          {lockedStatus && <p role="status" className="mt-3 text-fg-muted">{submission?.status === "DISQUALIFIED" ? "This submission was disqualified by the organizers." : "Judging has started, so the submission is locked."}</p>}

          <section aria-labelledby="details-heading" className="mt-10">
            <h2 id="details-heading" className="text-h3 font-semibold">Details</h2>
            <div className="mt-4">
              <SubmissionForm
                eventId={event.id}
                status={!submission ? "NONE" : submission.status === "DRAFT" ? "DRAFT" : "SUBMITTED"}
                locked={locked}
                values={{
                  title: submission?.title === "Untitled project" ? "" : (submission?.title ?? ""),
                  description: submission?.description === "(not written yet)" ? "" : (submission?.description ?? ""),
                  repoUrl: submission?.repoUrl ?? "", demoUrl: submission?.demoUrl ?? "", extraLinks: (submission?.extraLinks ?? []).join("\n"),
                }}
              />
            </div>
          </section>

          <section aria-labelledby="files-heading" className="mt-10">
            <h2 id="files-heading" className="text-h3 font-semibold">Files</h2>
            <div className="mt-4">
              <FileManager eventId={event.id} submissionId={submission?.id ?? null} files={submission?.files ?? []} locked={locked} />
            </div>
          </section>

          {versions.length > 0 && (
            <section aria-labelledby="history-heading" className="mt-10">
              <h2 id="history-heading" className="text-h3 font-semibold">Version history</h2>
              <ol className="mt-4 space-y-3">
                {versions.map((v) => {
                  const snap = v.snapshot as { title?: string; files?: unknown[] };
                  return (
                    <li key={v.version} className="rounded-lg bg-surface p-4 shadow-card">
                      <p className="font-medium">Version {v.version}{v.version === submission?.currentVersion ? " (current)" : ""}: {snap.title}</p>
                      <p className="text-sm text-fg-muted">
                        <time dateTime={v.createdAt.toISOString()}>{formatDateTime(v.createdAt, "UTC")}</time> by {v.createdBy?.fullName ?? "a former member"}, {snap.files?.length ?? 0} {snap.files?.length === 1 ? "file" : "files"}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </>
      )}
    </>
  );
}
