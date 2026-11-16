"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { rateLimitMessage, sendJson, type ApiResult } from "@/components/auth/api";
import { FormAlert, FormNotice } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function AssignJudgeForm({ eventId }: { eventId: string }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const res = await sendJson(`/api/v1/events/${eventId}/judges`, { email: new FormData(e.currentTarget).get("email") });
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
    <form ref={ref} onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Assign a judge">
      {general && <FormAlert>{general}</FormAlert>}
      {result?.ok && <FormNotice>Judge assigned. They will be signed out once so the new role takes effect.</FormNotice>}
      <Field label="Judge's email address" required error={errors.email} hint="They need a confirmed ShadowTrix account. The role applies to this event only.">
        {(p) => <Input {...p} name="email" type="email" autoComplete="off" inputMode="email" />}
      </Field>
      <Button type="submit" variant="secondary" disabled={pending} aria-disabled={pending}>{pending ? "Assigning" : "Assign judge"}</Button>
    </form>
  );
}
