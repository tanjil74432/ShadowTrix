"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { rateLimitMessage, sendJson } from "@/components/auth/api";
import { FormAlert, FormNotice } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";

export type RegistrationView =
  | { kind: "anonymous"; loginHref: string; blocked?: string }
  | { kind: "registered"; status: "CONFIRMED" | "WAITLISTED"; canCancel: boolean }
  | { kind: "blocked"; message: string }
  | { kind: "open"; full: boolean };

/** Register / cancel for the signed-in participant. The server decides everything; this only sends the request. */
export function RegistrationPanel({ eventId, view }: { eventId: string; view: RegistrationView }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(method: "POST" | "DELETE") {
    setPending(true);
    setError(null);
    const res = await sendJson(`/api/v1/events/${eventId}/registrations`, undefined, method);
    setPending(false);
    if (res.ok) router.refresh();
    else setError(res.status === 429 ? rateLimitMessage(res.retryAfterSeconds) : (res.message ?? "Something went wrong."));
  }

  return (
    <section aria-labelledby="registration-heading" className="space-y-4 rounded-lg bg-surface p-6 shadow-card">
      <h2 id="registration-heading" className="text-h3 font-semibold">
        Registration
      </h2>
      {error && <FormAlert>{error}</FormAlert>}
      {view.kind === "anonymous" && (
        <>
          <p className="text-fg-muted">{view.blocked ?? "Log in to register for this event."}</p>
          {!view.blocked && (
            <Button asChild size="lg" className="w-full">
              <Link href={view.loginHref}>Log in to register</Link>
            </Button>
          )}
        </>
      )}
      {view.kind === "blocked" && <FormNotice>{view.message}</FormNotice>}
      {view.kind === "open" && (
        <>
          <p className="text-fg-muted">{view.full ? "This event is full. You can join the waiting list and will be confirmed automatically if a place opens." : "Reserve your place. You can cancel any time before the event ends."}</p>
          <Button size="lg" className="w-full" onClick={() => run("POST")} disabled={pending} aria-disabled={pending}>
            {pending ? "Registering" : view.full ? "Join the waiting list" : "Register for this event"}
          </Button>
        </>
      )}
      {view.kind === "registered" && (
        <>
          <FormNotice>{view.status === "CONFIRMED" ? "You are registered. Your place is confirmed." : "You are on the waiting list. You will be confirmed automatically if a place opens."}</FormNotice>
          {view.canCancel && (
            <Button variant="secondary" className="w-full" onClick={() => run("DELETE")} disabled={pending} aria-disabled={pending}>
              {pending ? "Cancelling" : "Cancel my registration"}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
