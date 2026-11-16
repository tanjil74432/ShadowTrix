"use client";

import Link from "next/link";
import { useState } from "react";
import { rateLimitMessage, sendJson } from "@/components/auth/api";
import { FormAlert, ResultPanel } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";

/** Accept or decline. Opening the emailed link changes nothing; only pressing a button here does. */
export function InvitationResponse({ token, id }: { token?: string; id?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ joined: boolean; teamId: string } | null>(null);

  async function answer(accept: boolean) {
    setPending(true);
    setError(null);
    const res = await sendJson("/api/v1/team-invitations/respond", token ? { token, accept } : { id, accept });
    setPending(false);
    if (res.ok) setDone(res.data as { joined: boolean; teamId: string });
    else setError(res.status === 429 ? rateLimitMessage(res.retryAfterSeconds) : (res.message ?? "Something went wrong."));
  }

  if (done) {
    return done.joined ? (
      <ResultPanel title="You joined the team">
        <Button asChild>
          <Link href={`/teams/${done.teamId}`}>Open the team</Link>
        </Button>
      </ResultPanel>
    ) : (
      <ResultPanel title="Invitation declined">
        <p>The team leader is not told your reasons. You can still create or join another team.</p>
        <Button asChild variant="secondary">
          <Link href="/dashboard">Back to your dashboard</Link>
        </Button>
      </ResultPanel>
    );
  }
  return (
    <div className="space-y-4">
      {error && <FormAlert>{error}</FormAlert>}
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => answer(true)} disabled={pending} aria-disabled={pending}>
          Accept invitation
        </Button>
        <Button variant="secondary" onClick={() => answer(false)} disabled={pending} aria-disabled={pending}>
          Decline
        </Button>
      </div>
    </div>
  );
}
