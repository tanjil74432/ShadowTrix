import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { InvitationResponse } from "@/components/team/invitation-response";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/modules/auth/dal";
import { previewInvitation } from "@/server/modules/teams/teams.service";

export const metadata: Metadata = { title: "Team invitation", robots: { index: false, follow: false }, referrer: "no-referrer" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function TeamInvitationPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Container className="max-w-2xl py-14 sm:py-20">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Invitation searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function Invitation({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).token;
  const token = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  // The link carries a secret, so after login the person comes back to exactly this address.
  const user = await requireUser(`/team-invitations?token=${encodeURIComponent(token)}`);
  await connection();
  const preview = token.length >= 20 ? await previewInvitation(user, token) : null;
  return (
    <>
      <h1 className="text-h1 font-semibold">Team invitation</h1>
      {!preview ? (
        <div className="mt-6 space-y-4">
          <p className="text-fg-muted">
            This invitation was not found for your account. Check that you are logged in with the email address the invitation was sent to. If it was already answered or has expired, ask the team leader for a new one.
          </p>
          <Button asChild variant="secondary">
            <Link href="/dashboard">Go to your dashboard</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <p className="text-body-lg text-fg-muted text-pretty">
            <strong className="text-fg">{preview.inviterName}</strong> invited you to join the team <strong className="text-fg">{preview.teamName}</strong> for{" "}
            <Link href={`/events/${preview.eventSlug}`} className="underline underline-offset-4">{preview.eventTitle}</Link>.
          </p>
          {preview.status !== "PENDING" ? (
            <p role="status" className="text-fg-muted">This invitation was already answered.</p>
          ) : preview.expired ? (
            <p role="status" className="text-fg-muted">This invitation has expired. Ask the team leader for a new one.</p>
          ) : (
            <InvitationResponse token={token} />
          )}
        </div>
      )}
    </>
  );
}
