"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/skeleton";
import { safeNextPath } from "@/lib/safe-redirect";
import { rateLimitMessage, sendJson, type ApiResult } from "./api";
import { FormAlert, FormNotice, PasswordInput } from "./form-parts";
import { ResendVerificationForm } from "./resend-verification-form";

export function LoginForm() {
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [email, setEmail] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setEmail(String(form.get("email") ?? ""));
    setPending(true);
    const res = await sendJson("/api/v1/auth/login", { email: form.get("email"), password: form.get("password") });
    if (res.ok) {
      // Full navigation so the server renders the next page with the new session cookie.
      window.location.assign(next);
      return;
    }
    setPending(false);
    setResult(res);
  }

  const errors = result?.fieldErrors ?? {};
  const failed = result && !result.ok;
  const general =
    failed && Object.keys(errors).length === 0
      ? result.status === 429
        ? rateLimitMessage(result.retryAfterSeconds)
        : result.message
      : null;

  return (
    <div className="space-y-5">
      {params.get("verified") === "1" && <FormNotice>Your email address is confirmed. You can log in now.</FormNotice>}
      {params.get("reset") === "1" && <FormNotice>Your password was changed. Log in with the new password.</FormNotice>}

      <form onSubmit={onSubmit} noValidate className="space-y-5" aria-label="Log in">
        {general && <FormAlert>{general}</FormAlert>}
        <Field label="Email address" required error={errors.email}>
          {(p) => <Input {...p} name="email" type="email" autoComplete="username" inputMode="email" defaultValue={email} />}
        </Field>
        <Field label="Password" required error={errors.password}>
          {(p) => <PasswordInput {...p} name="password" autoComplete="current-password" />}
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={pending} aria-disabled={pending}>
          {pending ? <Spinner label="Logging in" className="text-bg" /> : "Log in"}
        </Button>
        <p className="text-sm">
          <Link href="/forgot-password" className="text-fg-muted underline underline-offset-4 hover:text-fg">
            Forgot your password?
          </Link>
        </p>
      </form>

      {failed && result.code === "email_not_verified" && (
        <div className="rounded-lg border border-border-strong p-4">
          <p className="mb-3 text-sm font-medium">Need a new confirmation link?</p>
          <ResendVerificationForm defaultEmail={email} />
        </div>
      )}
    </div>
  );
}
