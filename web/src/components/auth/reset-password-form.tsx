"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PASSWORD_HINT } from "@/lib/password-policy";
import { rateLimitMessage, sendJson, type ApiResult } from "./api";
import { FormAlert, PasswordInput, ResultPanel } from "./form-parts";

export function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <ResultPanel title="This link is not valid">
        <p>The reset link is incomplete. Request a new one to continue.</p>
        <Link href="/forgot-password" className="font-medium text-fg underline underline-offset-4">
          Request a new link
        </Link>
      </ResultPanel>
    );
  }

  if (done) {
    return (
      <ResultPanel title="Password changed">
        <p>Your password has been updated and every device was signed out.</p>
        <Button asChild>
          <Link href="/login?reset=1">Log in</Link>
        </Button>
      </ResultPanel>
    );
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const res = await sendJson("/api/v1/auth/reset-password", { token, password: new FormData(e.currentTarget).get("password") });
    setPending(false);
    if (res.ok) setDone(true);
    else setResult(res);
  }

  const errors = result?.fieldErrors ?? {};
  const invalid = result && !result.ok && result.code === "invalid_token";
  const general = result && !result.ok && Object.keys(errors).length === 0 && !invalid ? (result.status === 429 ? rateLimitMessage(result.retryAfterSeconds) : result.message) : null;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" aria-label="Choose a new password">
      {invalid && (
        <FormAlert>
          This link is invalid or has expired.{" "}
          <Link href="/forgot-password" className="underline underline-offset-4">
            Request a new one
          </Link>
          .
        </FormAlert>
      )}
      {general && <FormAlert>{general}</FormAlert>}
      <Field label="New password" required error={errors.password} hint={PASSWORD_HINT}>
        {(p) => <PasswordInput {...p} name="password" autoComplete="new-password" />}
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending} aria-disabled={pending}>
        {pending ? "Saving" : "Change password"}
      </Button>
    </form>
  );
}
