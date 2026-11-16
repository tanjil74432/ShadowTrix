"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { sendJson } from "@/components/auth/api";
import { FormAlert, FormNotice } from "@/components/auth/form-parts";
import { useHydrated } from "@/components/common/use-hydrated";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";

/** Turn read-only maintenance mode on or off. Turning it on asks for confirmation; turning it off never does. */
export function MaintenanceControls({ enabled, message }: { enabled: boolean; message: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  async function send(next: boolean, text?: string) {
    setPending(true);
    setError(null);
    setFieldError(undefined);
    setSaved(false);
    const res = await sendJson("/api/v1/admin/maintenance", { enabled: next, ...(text !== undefined ? { message: text } : {}) }, "PUT");
    setPending(false);
    if (!res.ok) {
      setFieldError(res.fieldErrors.message);
      if (!res.fieldErrors.message) setError(res.message ?? "Something went wrong.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = String(new FormData(e.currentTarget).get("message") ?? "");
    if (!enabled && !window.confirm("Turn maintenance mode ON? Public changes (sign-up, registration, uploads and so on) are paused for everyone except administrators. You can turn it off here at any time.")) return;
    void send(true, text);
  }

  return (
    <div className="space-y-4">
      {error && <FormAlert>{error}</FormAlert>}
      <form onSubmit={onSubmit} noValidate className="max-w-xl space-y-4" aria-label="Maintenance message">
        <Field label="Message shown to the public" required error={fieldError} hint="5 to 300 characters. Shown as a banner and returned by paused actions.">
          {(p) => <Textarea {...p} name="message" defaultValue={message} maxLength={300} className="min-h-24" />}
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant={enabled ? "secondary" : "primary"} disabled={pending || !hydrated} aria-disabled={pending || !hydrated}>{enabled ? "Update message" : "Turn maintenance mode on"}</Button>
          {enabled && <Button type="button" variant="primary" disabled={pending || !hydrated} aria-disabled={pending || !hydrated} onClick={() => void send(false)}>Turn maintenance mode off</Button>}
          <span role="status" className="text-sm text-fg-muted">{saved ? "Saved." : ""}</span>
        </div>
        {enabled && <FormNotice>Maintenance mode is on. Administrators and sign-in keep working, so you cannot lock yourself out.</FormNotice>}
      </form>
    </div>
  );
}
