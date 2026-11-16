"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { rateLimitMessage, sendJson } from "@/components/auth/api";
import { FormAlert } from "@/components/auth/form-parts";
import { useHydrated } from "@/components/common/use-hydrated";
import { Button } from "@/components/ui/button";

interface Props {
  url: string;
  method?: "POST" | "DELETE" | "PATCH" | "PUT";
  body?: Record<string, unknown>;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  /** Ask for confirmation first. */
  confirm?: string;
  /** Ask for a written reason first (at least 5 characters); sent as `reason`. */
  askReason?: string;
  /** Navigate here on success instead of refreshing. */
  doneHref?: string;
  className?: string;
}

/**
 * One button that calls an API endpoint and then refreshes the page, showing the server's message when it refuses.
 * The server decides everything; this only sends the request.
 */
export function ApiButton({ url, method = "POST", body, children, variant = "secondary", confirm, askReason, doneHref, className }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated(); // disabled until the page is interactive, so an early tap is never lost
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    let reason: string | undefined;
    if (askReason) {
      const answer = window.prompt(askReason);
      if (answer === null) return;
      reason = answer.trim();
    }
    setPending(true);
    setError(null);
    setDone(false);
    const res = await sendJson(url, reason !== undefined ? { ...body, reason } : body, method as "POST");
    setPending(false);
    if (res.ok) {
      if (doneHref) router.push(doneHref);
      else {
        setDone(true); // inline confirmation (announced to assistive technology); cleared on the next action
        router.refresh();
      }
    } else {
      setError(res.status === 429 ? rateLimitMessage(res.retryAfterSeconds) : Object.values(res.fieldErrors)[0] ?? res.message ?? "Something went wrong.");
    }
  }

  return (
    <span className="inline-flex flex-col gap-2">
      {error && <FormAlert>{error}</FormAlert>}
      <span role="status" className="text-sm text-fg-muted">{done ? "Done." : ""}</span>
      <Button type="button" variant={variant} className={className} onClick={run} disabled={pending || !hydrated} aria-disabled={pending || !hydrated}>
        {children}
      </Button>
    </span>
  );
}
