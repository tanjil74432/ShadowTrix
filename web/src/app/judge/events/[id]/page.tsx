import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { ProtectedArea } from "@/components/auth/protected-area";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/modules/auth/dal";
import { listAssignedSubmissions } from "@/server/modules/judging/judging.service";

export const metadata: Metadata = { title: "Judging", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

export default function JudgeEventPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<Container className="py-14"><Skeleton className="h-40 w-full" /></Container>}>
      <Gate params={params} />
    </Suspense>
  );
}

async function Gate({ params }: { params: Params }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  return (
    <ProtectedArea anyRole="JUDGE" returnTo={`/judge/events/${id.data}`} area="this event">
      <Container className="py-14 sm:py-20">
        <List id={id.data} />
      </Container>
    </ProtectedArea>
  );
}

const LABEL = { NOT_STARTED: "Not started", DRAFT: "Draft saved", FINAL: "Finalized" } as const;

async function List({ id }: { id: string }) {
  const user = await requireUser(`/judge/events/${id}`);
  await connection();
  let items;
  try {
    items = await listAssignedSubmissions(user, id);
  } catch {
    notFound(); // not assigned: the event does not exist for this person
  }
  return (
    <>
      <p className="text-sm"><Link href="/judge" className="underline underline-offset-4 text-fg-muted">Judge area</Link></p>
      <h1 className="mt-4 text-h1 font-semibold">Projects to score</h1>
      <p className="mt-2 text-fg-muted">Projects are anonymous. You cannot score a project you took part in.</p>
      {items.length === 0 ? (
        <EmptyState className="mt-8" title="No submitted projects yet" description="Projects appear here once teams or participants have submitted them." />
      ) : (
        <ul className="mt-8 space-y-3">
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-4 shadow-card">
              <Link href={`/judge/submissions/${s.id}`} className="font-medium underline underline-offset-4">{s.title}</Link>
              <Badge className="text-fg">{LABEL[s.state]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
