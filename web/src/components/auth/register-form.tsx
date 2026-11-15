"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/skeleton";
import { rateLimitMessage, sendJson, type ApiResult } from "./api";
import { FormAlert, ResultPanel } from "./form-parts";

export function RegisterForm() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    const res = await sendJson("/api/v1/auth/register", {
      email: form.get("email"),
    });
    setPending(false);
    if (res.ok) setDone(String(form.get("email")));
    else setResult(res);
  }

  if (done) {
    return (
      <ResultPanel title="Check your email">
        <p>
          If <strong className="text-fg">{done}</strong> can be used for a new account, we have sent a message with a link to confirm it and choose your password. The link expires in
          24 hours.
        </p>
        <p>If you already have an account, the message will tell you how to log in. Nothing arrived? Check your spam folder.</p>
        <p>
          <Link href="/login" className="font-medium text-fg underline underline-offset-4">
            Go to login
          </Link>
        </p>
      </ResultPanel>
    );
  }

  const errors = result?.fieldErrors ?? {};
  const general = result && !result.ok && Object.keys(errors).length === 0 ? (result.status === 429 ? rateLimitMessage(result.retryAfterSeconds) : result.message) : null;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" aria-label="Create an account">
      {general && <FormAlert>{general}</FormAlert>}
      <Field label="Email address" required error={errors.email} hint="We will email you a link to confirm it. You choose your password after that.">
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" inputMode="email" />}
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending} aria-disabled={pending}>
        {pending ? <Spinner label="Sending link" className="text-bg" /> : "Send confirmation link"}
      </Button>
    </form>
  );
}
