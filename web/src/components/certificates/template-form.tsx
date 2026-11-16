"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { rateLimitMessage, sendJson, type ApiResult } from "@/components/auth/api";
import { FormAlert, FormNotice } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";

interface Props { eventId: string; type: "PARTICIPATION" | "FINALIST" | "WINNER"; heading: string; body: string; signatoryName: string; signatoryTitle: string; isDefault: boolean }

export function TemplateForm({ eventId, type, heading, body, signatoryName, signatoryTitle, isDefault }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    const res = await sendJson(`/api/v1/events/${eventId}/certificate-templates/${type}`, { heading: f.get("heading"), body: f.get("body"), signatoryName: f.get("signatoryName"), signatoryTitle: f.get("signatoryTitle") }, "PUT");
    setPending(false);
    setResult(res);
    if (res.ok) router.refresh();
  }
  const errors = result?.fieldErrors ?? {};
  const general = result && !result.ok && Object.keys(errors).length === 0 ? (result.status === 429 ? rateLimitMessage(result.retryAfterSeconds) : result.message) : null;
  const label = type === "PARTICIPATION" ? "Participation" : type === "FINALIST" ? "Finalist" : "Winner";
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-lg bg-surface p-4 shadow-card" aria-label={`${label} certificate template`}>
      <h3 className="font-semibold">{label} certificate {isDefault && <span className="text-sm font-normal text-fg-subtle">(built-in wording)</span>}</h3>
      {general && <FormAlert>{general}</FormAlert>}
      {result?.ok && <FormNotice>Template saved.</FormNotice>}
      <Field label="Heading" required error={errors.heading}>{(p) => <Input {...p} name="heading" defaultValue={heading} maxLength={80} />}</Field>
      <Field label="Text" required error={errors.body} hint="You can use {{name}}, {{event}}, {{team}}, {{project}} and {{rank}}.">{(p) => <Textarea {...p} name="body" defaultValue={body} maxLength={600} className="min-h-24" />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Signatory name" error={errors.signatoryName}>{(p) => <Input {...p} name="signatoryName" defaultValue={signatoryName} maxLength={80} />}</Field>
        <Field label="Signatory title" error={errors.signatoryTitle}>{(p) => <Input {...p} name="signatoryTitle" defaultValue={signatoryTitle} maxLength={80} />}</Field>
      </div>
      <Button type="submit" variant="secondary" disabled={pending} aria-disabled={pending}>{pending ? "Saving" : "Save template"}</Button>
    </form>
  );
}
