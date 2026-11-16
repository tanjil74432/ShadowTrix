"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { rateLimitMessage, sendJson, type ApiResult } from "@/components/auth/api";
import { FormAlert } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";

export function CreateTeamForm({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    const res = await sendJson(`/api/v1/events/${eventId}/teams`, { name: f.get("name"), description: f.get("description") });
    setPending(false);
    setResult(res);
    if (res.ok) router.push(`/teams/${(res.data as { id: string }).id}`);
  }
  const errors = result?.fieldErrors ?? {};
  const general = result && !result.ok && Object.keys(errors).length === 0 ? (result.status === 429 ? rateLimitMessage(result.retryAfterSeconds) : result.message) : null;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Create a team">
      {general && <FormAlert>{general}</FormAlert>}
      <Field label="Team name" required error={errors.name}>
        {(p) => <Input {...p} name="name" maxLength={60} />}
      </Field>
      <Field label="Description" error={errors.description} hint="Optional, up to 500 characters.">
        {(p) => <Textarea {...p} name="description" maxLength={500} className="min-h-20" />}
      </Field>
      <Button type="submit" disabled={pending} aria-disabled={pending}>
        {pending ? "Creating" : "Create team"}
      </Button>
    </form>
  );
}
