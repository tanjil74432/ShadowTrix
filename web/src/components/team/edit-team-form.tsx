"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { rateLimitMessage, sendJson, type ApiResult } from "@/components/auth/api";
import { FormAlert, FormNotice } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";

export function EditTeamForm({ teamId, name, description }: { teamId: string; name: string; description: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    const res = await sendJson(`/api/v1/teams/${teamId}`, { name: f.get("name"), description: f.get("description") }, "PATCH");
    setPending(false);
    setResult(res);
    if (res.ok) router.refresh();
  }
  const errors = result?.fieldErrors ?? {};
  const general = result && !result.ok && Object.keys(errors).length === 0 ? (result.status === 429 ? rateLimitMessage(result.retryAfterSeconds) : result.message) : null;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Edit team">
      {general && <FormAlert>{general}</FormAlert>}
      {result?.ok && <FormNotice>Team saved.</FormNotice>}
      <Field label="Team name" required error={errors.name}>
        {(p) => <Input {...p} name="name" defaultValue={name} maxLength={60} />}
      </Field>
      <Field label="Description" error={errors.description}>
        {(p) => <Textarea {...p} name="description" defaultValue={description} maxLength={500} className="min-h-20" />}
      </Field>
      <Button type="submit" variant="secondary" disabled={pending} aria-disabled={pending}>
        {pending ? "Saving" : "Save team"}
      </Button>
    </form>
  );
}
