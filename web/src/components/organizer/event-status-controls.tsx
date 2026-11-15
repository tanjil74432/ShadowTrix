"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { rateLimitMessage, sendJson } from "@/components/auth/api";
import { FormAlert } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";

type Action = "publish" | "unpublish" | "cancel" | "archive";

const CONFIRM: Partial<Record<Action, string>> = {
  cancel: "Cancel this event? Registered people will see it as cancelled. This cannot be undone.",
  archive: "Archive this event? It disappears from public pages and can no longer be edited.",
};

/** Publishing controls. Buttons offered here mirror the server's lifecycle rules; the server decides regardless. */
export function EventStatusControls({ eventId, status, registrationClosed }: { eventId: string; status: "DRAFT" | "PUBLISHED" | "CANCELLED" | "ARCHIVED"; registrationClosed: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(url: string, body: unknown) {
    setPending(true);
    setError(null);
    const res = await sendJson(url, body);
    setPending(false);
    if (res.ok) router.refresh();
    else setError(res.status === 429 ? rateLimitMessage(res.retryAfterSeconds) : (res.message ?? "Something went wrong."));
  }
  const act = (action: Action) => {
    const msg = CONFIRM[action];
    if (msg && !window.confirm(msg)) return;
    void call(`/api/v1/events/${eventId}/status`, { action });
  };

  return (
    <div className="space-y-3">
      {error && <FormAlert>{error}</FormAlert>}
      <div className="flex flex-wrap gap-3">
        {status === "DRAFT" && <Button onClick={() => act("publish")} disabled={pending}>Publish event</Button>}
        {status === "PUBLISHED" && (
          <>
            <Button variant="secondary" onClick={() => void call(`/api/v1/events/${eventId}/registration-window`, { closed: !registrationClosed })} disabled={pending}>
              {registrationClosed ? "Reopen registration" : "Close registration"}
            </Button>
            <Button variant="secondary" onClick={() => act("unpublish")} disabled={pending}>Back to draft</Button>
            <Button variant="secondary" onClick={() => act("cancel")} disabled={pending}>Cancel event</Button>
          </>
        )}
        {status !== "ARCHIVED" && <Button variant="ghost" onClick={() => act("archive")} disabled={pending}>Archive</Button>}
      </div>
    </div>
  );
}
