"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { rateLimitMessage, sendJson, type ApiResult } from "@/components/auth/api";
import { FormAlert, FormNotice } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";

interface Props {
  eventId: string;
  status: "NONE" | "DRAFT" | "SUBMITTED";
  values: { title: string; description: string; repoUrl: string; demoUrl: string; extraLinks: string };
  locked: boolean;
}

/** Project details. Draft saves are private; submitting (or resubmitting) records a version that judges see. */
export function SubmissionForm({ eventId, status, values, locked }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function read(form: HTMLFormElement) {
    const f = new FormData(form);
    return {
      title: f.get("title"), description: f.get("description"), repoUrl: f.get("repoUrl"), demoUrl: f.get("demoUrl"),
      extraLinks: String(f.get("extraLinks") ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    };
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent = submitter?.value === "draft" ? "draft" : "submit";
    const body = read(e.currentTarget);
    setPending(true);
    setSaved(null);
    const res = intent === "draft" ? await sendJson(`/api/v1/events/${eventId}/my-submission`, body, "PUT") : await sendJson(`/api/v1/events/${eventId}/my-submission/submit`, body);
    setPending(false);
    setResult(res);
    if (res.ok) {
      setSaved(intent === "draft" ? "Draft saved. Judges cannot see it yet." : status === "SUBMITTED" ? "Resubmitted. A new version was recorded." : "Project submitted.");
      router.refresh();
    }
  }

  const errors = result?.fieldErrors ?? {};
  const general = result && !result.ok && Object.keys(errors).length === 0 ? (result.status === 429 ? rateLimitMessage(result.retryAfterSeconds) : result.message) : null;
  const first = Object.entries(errors).length;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" aria-label="Project submission">
      {general && <FormAlert>{general}</FormAlert>}
      {first > 0 && <FormAlert>Fix the {first === 1 ? "field" : `${first} fields`} marked below and try again.</FormAlert>}
      {saved && <FormNotice>{saved}</FormNotice>}
      <Field label="Project title" required error={errors.title}>
        {(p) => <Input {...p} name="title" defaultValue={values.title} maxLength={120} disabled={locked} />}
      </Field>
      <Field label="Description" required error={errors.description} hint="What it does, how you built it, what is next (20 to 5000 characters).">
        {(p) => <Textarea {...p} name="description" defaultValue={values.description} maxLength={5000} className="min-h-40" disabled={locked} />}
      </Field>
      <Field label="Repository link" error={errors.repoUrl} hint="GitHub, GitLab, Bitbucket or Codeberg, starting with https://">
        {(p) => <Input {...p} name="repoUrl" type="url" defaultValue={values.repoUrl} disabled={locked} />}
      </Field>
      <Field label="Live demo link" error={errors.demoUrl} hint="Starting with https://">
        {(p) => <Input {...p} name="demoUrl" type="url" defaultValue={values.demoUrl} disabled={locked} />}
      </Field>
      <Field label="Additional links" error={errors.extraLinks} hint="One link per line (slides, video, documentation). At most 5, each starting with https://">
        {(p) => <Textarea {...p} name="extraLinks" defaultValue={values.extraLinks} className="min-h-24" disabled={locked} />}
      </Field>
      {!locked && (
        <div className="flex flex-wrap gap-3">
          {status !== "SUBMITTED" && (
            <Button type="submit" name="intent" value="draft" variant="secondary" disabled={pending} aria-disabled={pending}>
              Save draft
            </Button>
          )}
          <Button type="submit" name="intent" value="submit" size="lg" disabled={pending} aria-disabled={pending}>
            {pending ? "Saving" : status === "SUBMITTED" ? "Resubmit changes" : "Submit project"}
          </Button>
        </div>
      )}
    </form>
  );
}
