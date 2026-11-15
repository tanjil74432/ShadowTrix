"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { rateLimitMessage, sendJson, type ApiResult } from "@/components/auth/api";
import { FormAlert, FormNotice } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EVENT_CATEGORIES } from "@/lib/event-categories";

export interface EventFormValues {
  title: string;
  category: string;
  summary: string;
  description: string;
  startsAt: string;
  endsAt: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  submissionDeadline: string;
  judgingStartsAt: string;
  judgingEndsAt: string;
  resultsAnnouncementAt: string;
  capacity: string;
  locationType: string;
  location: string;
  eligibility: string;
}

export const EMPTY_EVENT: EventFormValues = {
  title: "", category: "HACKATHON", summary: "", description: "", startsAt: "", endsAt: "", registrationOpensAt: "", registrationClosesAt: "",
  submissionDeadline: "", judgingStartsAt: "", judgingEndsAt: "", resultsAnnouncementAt: "", capacity: "", locationType: "ONLINE", location: "", eligibility: "",
};

/** "2031-05-02T09:30" (a datetime-local value) -> ISO in UTC. Empty stays empty. */
const toIso = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s ? `${s}:00.000Z` : "";
};

const DATE_FIELDS = [
  ["registrationOpensAt", "Registration opens", true],
  ["registrationClosesAt", "Registration closes", true],
  ["startsAt", "Event starts", true],
  ["endsAt", "Event ends", true],
  ["submissionDeadline", "Submission deadline", false],
  ["judgingStartsAt", "Judging starts", false],
  ["judgingEndsAt", "Judging ends", false],
  ["resultsAnnouncementAt", "Results announced", false],
] as const;

/** Create or edit an event. All checks are repeated on the server; this form only shows the server's messages. */
export function EventForm({ mode, eventId, values = EMPTY_EVENT }: { mode: "create" | "edit"; eventId?: string; values?: EventFormValues }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      title: f.get("title"), category: f.get("category"), summary: f.get("summary"), description: f.get("description"),
      capacity: String(f.get("capacity") ?? "").trim(), locationType: f.get("locationType"), location: f.get("location"), eligibility: f.get("eligibility"),
    };
    for (const [key] of DATE_FIELDS) body[key] = toIso(f.get(key));
    setPending(true);
    const res = await sendJson(mode === "create" ? "/api/v1/events" : `/api/v1/events/${eventId}`, body, mode === "create" ? "POST" : "PATCH");
    setPending(false);
    setResult(res);
    if (!res.ok) return;
    if (mode === "create") {
      const id = (res.data as { id?: string } | undefined)?.id;
      router.push(id ? `/organizer/events/${id}` : "/organizer");
    } else {
      router.refresh();
    }
  }

  const errors = result?.fieldErrors ?? {};
  const general = result && !result.ok && Object.keys(errors).length === 0 ? (result.status === 429 ? rateLimitMessage(result.retryAfterSeconds) : result.message) : null;
  const fieldErrorCount = Object.keys(errors).length;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6" aria-label={mode === "create" ? "Create event" : "Edit event"}>
      {general && <FormAlert>{general}</FormAlert>}
      {fieldErrorCount > 0 && <FormAlert>Fix the {fieldErrorCount === 1 ? "field" : `${fieldErrorCount} fields`} marked below and try again.</FormAlert>}
      {result?.ok && mode === "edit" && <FormNotice>Event saved.</FormNotice>}
      <Field label="Title" required error={errors.title}>
        {(p) => <Input {...p} name="title" defaultValue={values.title} maxLength={120} />}
      </Field>
      <Field label="Category" required error={errors.category}>
        {(p) => (
          <Select {...p} name="category" defaultValue={values.category}>
            {Object.entries(EVENT_CATEGORIES).map(([k, c]) => (
              <option key={k} value={k}>{c.label}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Summary" required error={errors.summary} hint="One or two sentences shown on event cards (10 to 300 characters).">
        {(p) => <Textarea {...p} name="summary" defaultValue={values.summary} maxLength={300} className="min-h-20" />}
      </Field>
      <Field label="Description" required error={errors.description} hint="Shown on the event page. Separate paragraphs with a blank line.">
        {(p) => <Textarea {...p} name="description" defaultValue={values.description} maxLength={10000} className="min-h-48" />}
      </Field>

      <fieldset className="space-y-4">
        <legend className="text-h3 font-semibold">Dates (UTC)</legend>
        <p className="text-sm text-fg-muted">All times are in UTC. Registration must close before the event ends.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {DATE_FIELDS.map(([key, label, required]) => (
            <Field key={key} label={label} required={required} error={errors[key]}>
              {(p) => <Input {...p} name={key} type="datetime-local" defaultValue={values[key]} />}
            </Field>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-h3 font-semibold">Where and who</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Format" required error={errors.locationType}>
            {(p) => (
              <Select {...p} name="locationType" defaultValue={values.locationType}>
                <option value="ONLINE">Online</option>
                <option value="ONSITE">On site</option>
                <option value="HYBRID">Hybrid</option>
              </Select>
            )}
          </Field>
          <Field label="Location" error={errors.location} hint="City, venue or link description.">
            {(p) => <Input {...p} name="location" defaultValue={values.location} maxLength={200} />}
          </Field>
          <Field label="Capacity" error={errors.capacity} hint="Leave empty for no limit. Extra people join a waiting list.">
            {(p) => <Input {...p} name="capacity" type="number" min={1} max={100000} inputMode="numeric" defaultValue={values.capacity} />}
          </Field>
        </div>
        <Field label="Eligibility" error={errors.eligibility}>
          {(p) => <Textarea {...p} name="eligibility" defaultValue={values.eligibility} maxLength={1000} className="min-h-20" />}
        </Field>
      </fieldset>

      <Button type="submit" size="lg" disabled={pending} aria-disabled={pending}>
        {pending ? "Saving" : mode === "create" ? "Create draft event" : "Save changes"}
      </Button>
    </form>
  );
}
