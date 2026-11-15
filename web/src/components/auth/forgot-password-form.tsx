"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { rateLimitMessage, sendJson, type ApiResult } from "./api";
import { FormAlert, ResultPanel } from "./form-parts";

export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    setPending(true);
    const res = await sendJson("/api/v1/auth/forgot-password", { email });
    setPending(false);
    if (res.ok) setSentTo(email);
    else setResult(res);
  }

  if (sentTo) {
    return (
      <ResultPanel title="Check your email">
        <p>
          If an account exists for <strong className="text-fg">{sentTo}</strong>, we have sent instructions to reset the password. The link works once and expires in 60 minutes.
        </p>
        <p>
          <Link href="/login" className="font-medium text-fg underline underline-offset-4">
            Back to login
          </Link>
        </p>
      </ResultPanel>
    );
  }

  const errors = result?.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" aria-label="Request a password reset">
      {result && !result.ok && Object.keys(errors).length === 0 && (
        <FormAlert>{result.status === 429 ? rateLimitMessage(result.retryAfterSeconds) : result.message}</FormAlert>
      )}
      <Field label="Email address" required error={errors.email} hint="We will email a link if an account exists for this address.">
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" inputMode="email" />}
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending} aria-disabled={pending}>
        {pending ? "Sending" : "Send reset link"}
      </Button>
    </form>
  );
}
