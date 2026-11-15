"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { rateLimitMessage, sendJson, type ApiResult } from "./api";
import { FormAlert, FormNotice } from "./form-parts";

export function ResendVerificationForm({ defaultEmail = "" }: { defaultEmail?: string }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const res = await sendJson("/api/v1/auth/resend-verification", { email: new FormData(e.currentTarget).get("email") });
    setPending(false);
    if (res.ok) setSent(true);
    else setResult(res);
  }

  if (sent) {
    return <FormNotice>If that address has an unconfirmed account, we have sent a new link. Check your inbox.</FormNotice>;
  }
  const errors = result?.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Resend confirmation email">
      {result && !result.ok && Object.keys(errors).length === 0 && (
        <FormAlert>{result.status === 429 ? rateLimitMessage(result.retryAfterSeconds) : result.message}</FormAlert>
      )}
      <Field label="Email address" required error={errors.email}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" defaultValue={defaultEmail} />}
      </Field>
      <Button type="submit" variant="secondary" disabled={pending} aria-disabled={pending}>
        {pending ? "Sending" : "Send a new link"}
      </Button>
    </form>
  );
}
