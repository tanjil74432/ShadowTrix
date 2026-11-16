"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { rateLimitMessage, sendJson, type ApiResult } from "@/components/auth/api";
import { FormAlert } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function CriterionForm({ eventId }: { eventId: string }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    const res = await sendJson(`/api/v1/events/${eventId}/criteria`, { name: f.get("name"), description: f.get("description"), maxScore: f.get("maxScore"), weight: f.get("weight") || 1, sortOrder: f.get("sortOrder") || 0 });
    setPending(false);
    setResult(res);
    if (res.ok) {
      ref.current?.reset();
      router.refresh();
    }
  }
  const errors = result?.fieldErrors ?? {};
  const general = result && !result.ok && Object.keys(errors).length === 0 ? (result.status === 429 ? rateLimitMessage(result.retryAfterSeconds) : result.message) : null;
  return (
    <form ref={ref} onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2" aria-label="Add a criterion">
      {general && <div className="sm:col-span-2"><FormAlert>{general}</FormAlert></div>}
      <Field label="Name" required error={errors.name}>{(p) => <Input {...p} name="name" maxLength={80} />}</Field>
      <Field label="Description" error={errors.description}>{(p) => <Input {...p} name="description" maxLength={300} />}</Field>
      <Field label="Maximum score" required error={errors.maxScore} hint="For example 10 or 100.">{(p) => <Input {...p} name="maxScore" type="number" step="0.01" min={0.01} inputMode="decimal" />}</Field>
      <Field label="Weight" error={errors.weight} hint="Relative importance. Default 1.">{(p) => <Input {...p} name="weight" type="number" step="0.001" min={0.001} inputMode="decimal" />}</Field>
      <div className="sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={pending} aria-disabled={pending}>{pending ? "Adding" : "Add criterion"}</Button>
      </div>
    </form>
  );
}
