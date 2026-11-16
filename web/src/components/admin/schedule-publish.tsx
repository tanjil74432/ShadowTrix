"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { sendJson } from "@/components/auth/api";
import { FormAlert } from "@/components/auth/form-parts";
import { useHydrated } from "@/components/common/use-hydrated";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

/** Publish later: a UTC date and time. The server refuses nothing here except malformed values; a past time publishes now. */
export function SchedulePublish({ id }: { id: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = String(new FormData(e.currentTarget).get("at") ?? "").trim();
    if (!v) { setError("Choose a date and time (UTC)."); return; }
    setPending(true);
    setError(null);
    const res = await sendJson(`/api/v1/admin/announcements/${id}/publish`, { at: `${v}:00.000Z` });
    setPending(false);
    if (res.ok) router.refresh(); else setError(res.message ?? "Something went wrong.");
  }
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-end gap-3" aria-label="Schedule publication">
      {error && <FormAlert>{error}</FormAlert>}
      <div className="flex flex-col gap-1.5"><label htmlFor="sch-at" className="text-sm font-medium">Publish at (UTC)</label><Input id="sch-at" name="at" type="datetime-local" className="w-56" /></div>
      <Button type="submit" variant="secondary" disabled={pending || !hydrated} aria-disabled={pending || !hydrated}>Schedule</Button>
    </form>
  );
}
