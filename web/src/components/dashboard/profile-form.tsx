"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { rateLimitMessage, sendJson, type ApiResult } from "@/components/auth/api";
import { FormAlert, FormNotice } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";

export function ProfileForm({ fullName, bio }: { fullName: string; bio: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    const res = await sendJson("/api/v1/me/profile", { fullName: form.get("fullName"), bio: form.get("bio") }, "PATCH");
    setPending(false);
    setResult(res);
    if (res.ok) router.refresh();
  }

  const errors = result?.fieldErrors ?? {};
  const general = result && !result.ok && Object.keys(errors).length === 0 ? (result.status === 429 ? rateLimitMessage(result.retryAfterSeconds) : result.message) : null;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" aria-label="Edit profile">
      {general && <FormAlert>{general}</FormAlert>}
      {result?.ok && <FormNotice>Profile saved.</FormNotice>}
      <Field label="Full name" required error={errors.fullName}>
        {(p) => <Input {...p} name="fullName" autoComplete="name" defaultValue={fullName} />}
      </Field>
      <Field label="Short bio" error={errors.bio} hint="Up to 500 characters.">
        {(p) => <Textarea {...p} name="bio" defaultValue={bio} maxLength={500} />}
      </Field>
      <Button type="submit" disabled={pending} aria-disabled={pending}>
        {pending ? "Saving" : "Save profile"}
      </Button>
    </form>
  );
}
