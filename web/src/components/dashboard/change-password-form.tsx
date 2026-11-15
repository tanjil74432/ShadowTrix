"use client";

import { useRef, useState, type FormEvent } from "react";
import { rateLimitMessage, sendJson, type ApiResult } from "@/components/auth/api";
import { FormAlert, FormNotice, PasswordInput } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PASSWORD_HINT } from "@/lib/password-policy";

export function ChangePasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    const res = await sendJson("/api/v1/auth/change-password", { currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") });
    setPending(false);
    setResult(res);
    if (res.ok) formRef.current?.reset();
  }

  const errors = result?.fieldErrors ?? {};
  const wrongCurrent = result && !result.ok && result.code === "invalid_current_password" ? result.message : undefined;
  const general = result && !result.ok && Object.keys(errors).length === 0 && !wrongCurrent ? (result.status === 429 ? rateLimitMessage(result.retryAfterSeconds) : result.message) : null;
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5" aria-label="Change password">
      {general && <FormAlert>{general}</FormAlert>}
      {result?.ok && <FormNotice>Password changed. Your other devices were signed out.</FormNotice>}
      <Field label="Current password" required error={errors.currentPassword ?? wrongCurrent}>
        {(p) => <PasswordInput {...p} name="currentPassword" autoComplete="current-password" />}
      </Field>
      <Field label="New password" required error={errors.newPassword} hint={PASSWORD_HINT}>
        {(p) => <PasswordInput {...p} name="newPassword" autoComplete="new-password" />}
      </Field>
      <Button type="submit" disabled={pending} aria-disabled={pending}>
        {pending ? "Saving" : "Change password"}
      </Button>
    </form>
  );
}
