"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PASSWORD_HINT } from "@/lib/password-policy";
import { rateLimitMessage, sendJson, type ApiResult } from "./api";
import { FormAlert, PasswordInput, ResultPanel } from "./form-parts";
import { ResendVerificationForm } from "./resend-verification-form";

/**
 * Step 2 of signup. The emailed link only opens this page; the token is used when the person submits the form
 * (a POST). Mail scanners and link previewers fetch URLs automatically but never submit forms, so they cannot
 * consume the single-use token, and nobody but the holder of the link can choose the password.
 */
export function VerifyEmailPanel() {
  const token = useSearchParams().get("token") ?? "";
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    const res = await sendJson("/api/v1/auth/complete-registration", { token, fullName: form.get("fullName"), password: form.get("password") });
    setPending(false);
    if (res.ok) setDone(true);
    else setResult(res);
  }

  if (done) {
    return (
      <ResultPanel title="Your account is ready">
        <p>Your email address is confirmed and your password is set. You can log in now.</p>
        <Button asChild>
          <Link href="/login?verified=1">Log in</Link>
        </Button>
      </ResultPanel>
    );
  }

  if (!token || (result && !result.ok && result.code === "invalid_token")) {
    return (
      <div className="space-y-6">
        <ResultPanel title={token ? "This link is invalid or has expired" : "Open the link from your email"}>
          <p>
            {token
              ? "Confirmation links work once and expire after 24 hours. Enter your email address to receive a new one."
              : "We sent a confirmation link when you registered. If you need a new one, enter your email address below."}
          </p>
        </ResultPanel>
        <ResendVerificationForm />
      </div>
    );
  }

  const errors = result?.fieldErrors ?? {};
  const general = result && !result.ok && Object.keys(errors).length === 0 ? (result.status === 429 ? rateLimitMessage(result.retryAfterSeconds) : result.message) : null;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" aria-label="Confirm your email and choose a password">
      {general && <FormAlert>{general}</FormAlert>}
      <p className="text-fg-muted">Your link is valid. Tell us your name and choose a password to confirm your email address and activate your account.</p>
      <Field label="Full name" required error={errors.fullName}>
        {(p) => <Input {...p} name="fullName" autoComplete="name" />}
      </Field>
      <Field label="Password" required error={errors.password} hint={PASSWORD_HINT}>
        {(p) => <PasswordInput {...p} name="password" autoComplete="new-password" />}
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending} aria-disabled={pending}>
        {pending ? "Activating" : "Confirm email and activate account"}
      </Button>
    </form>
  );
}
