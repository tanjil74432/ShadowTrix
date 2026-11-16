"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { rateLimitMessage, sendJson, type ApiResult } from "@/components/auth/api";
import { FormAlert, FormNotice } from "@/components/auth/form-parts";
import { useHydrated } from "@/components/common/use-hydrated";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

export interface AnnouncementValues { title: string; body: string; audience: string; eventId: string }
export const EMPTY_ANNOUNCEMENT: AnnouncementValues = { title: "", body: "", audience: "ALL", eventId: "" };

/** Create or edit an announcement (always saved as a draft until published). The server repeats every check. */
export function AnnouncementForm({ id, values = EMPTY_ANNOUNCEMENT, events }: { id?: string; values?: AnnouncementValues; events: { id: string; title: string }[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { title: f.get("title"), body: f.get("body"), audience: f.get("audience"), eventId: String(f.get("eventId") ?? "") || null };
    setPending(true);
    const res = await sendJson(id ? `/api/v1/admin/announcements/${id}` : "/api/v1/admin/announcements", body, id ? "PUT" : "POST");
    setPending(false);
    setResult(res);
    if (!res.ok) return;
    if (id) router.refresh();
    else router.push(`/admin/announcements/${(res.data as { id: string }).id}`);
  }

  const errors = result?.fieldErrors ?? {};
  const general = result && !result.ok && Object.keys(errors).length === 0 ? (result.status === 429 ? rateLimitMessage(result.retryAfterSeconds) : result.message) : null;
  return (
    <form onSubmit={onSubmit} noValidate className="max-w-2xl space-y-5" aria-label={id ? "Edit announcement" : "New announcement"}>
      {general && <FormAlert>{general}</FormAlert>}
      {Object.keys(errors).length > 0 && <FormAlert>Fix the fields marked below and try again.</FormAlert>}
      {result?.ok && id && <FormNotice>Announcement saved.</FormNotice>}
      <Field label="Title" required error={errors.title}>{(p) => <Input {...p} name="title" defaultValue={values.title} maxLength={120} />}</Field>
      <Field label="Message" required error={errors.body} hint="Plain text. Up to 5000 characters.">{(p) => <Textarea {...p} name="body" defaultValue={values.body} maxLength={5000} className="min-h-40" />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Audience" required error={errors.audience}>
          {(p) => <Select {...p} name="audience" defaultValue={values.audience}><option value="ALL">Everyone signed in</option><option value="PARTICIPANTS">Participants</option><option value="ORGANIZERS">Organizers</option><option value="JUDGES">Judges</option></Select>}
        </Field>
        <Field label="Event" error={errors.eventId} hint="Leave empty for a platform-wide announcement. With an event, only people taking part in it see the message.">
          {(p) => <Select {...p} name="eventId" defaultValue={values.eventId}><option value="">Whole platform</option>{events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}</Select>}
        </Field>
      </div>
      <Button type="submit" disabled={pending || !hydrated} aria-disabled={pending || !hydrated}>{pending ? "Saving..." : id ? "Save changes" : "Save as draft"}</Button>
    </form>
  );
}
