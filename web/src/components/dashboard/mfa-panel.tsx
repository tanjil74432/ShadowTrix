"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { rateLimitMessage, sendJson, type ApiResult } from "@/components/auth/api";
import { FormAlert, FormNotice, PasswordInput } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

/**
 * Optional two-step verification for administrators. Nothing here is required: administrators who do not turn it on
 * keep signing in with their password. The server enforces who may enroll.
 */
export function MfaPanel({ enabled, recoveryCodesLeft }: { enabled: boolean; recoveryCodesLeft: number }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

  const problem = (r: ApiResult | null) =>
    r && !r.ok && Object.keys(r.fieldErrors).length === 0 ? (r.status === 429 ? rateLimitMessage(r.retryAfterSeconds) : r.message) : null;

  async function start() {
    setPending(true);
    const res = await sendJson("/api/v1/auth/mfa/enroll");
    setPending(false);
    setResult(res);
    if (res.ok) setSetup(res.data as { secret: string; uri: string });
  }
  async function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const res = await sendJson("/api/v1/auth/mfa/confirm", { code: new FormData(e.currentTarget).get("code") });
    setPending(false);
    setResult(res);
    if (res.ok) {
      setCodes((res.data as { recoveryCodes: string[] }).recoveryCodes);
      setSetup(null);
      router.refresh();
    }
  }
  async function disable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    const res = await sendJson("/api/v1/auth/mfa/disable", { password: f.get("password"), code: f.get("code") });
    setPending(false);
    setResult(res);
    if (res.ok) router.refresh();
  }

  const errors = result?.fieldErrors ?? {};
  const general = problem(result);

  if (codes) {
    return (
      <div className="space-y-4">
        <FormNotice>Two-step verification is on. Save these recovery codes now. Each works once, and they are not shown again.</FormNotice>
        <ul className="grid max-w-sm grid-cols-2 gap-2 rounded-lg bg-surface p-4 font-mono text-sm" aria-label="Recovery codes">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Button variant="secondary" onClick={() => setCodes(null)}>I have saved them</Button>
      </div>
    );
  }

  if (enabled) {
    return (
      <form onSubmit={disable} noValidate className="space-y-5" aria-label="Turn off two-step verification">
        <FormNotice>Two-step verification is on. {recoveryCodesLeft} recovery {recoveryCodesLeft === 1 ? "code is" : "codes are"} left.</FormNotice>
        {general && <FormAlert>{general}</FormAlert>}
        <Field label="Password" required error={errors.password}>
          {(p) => <PasswordInput {...p} name="password" autoComplete="current-password" />}
        </Field>
        <Field label="Authenticator or recovery code" required error={errors.code} hint="Needed to turn it off.">
          {(p) => <Input {...p} name="code" autoComplete="one-time-code" inputMode="text" />}
        </Field>
        <Button type="submit" variant="secondary" disabled={pending} aria-disabled={pending}>Turn off two-step verification</Button>
      </form>
    );
  }

  if (setup) {
    return (
      <form onSubmit={confirm} noValidate className="space-y-5" aria-label="Confirm two-step verification">
        {general && <FormAlert>{general}</FormAlert>}
        <p className="text-fg-muted">
          In your authenticator app choose &quot;add account&quot; and enter this key (or open the link on a phone that has the app), then type the 6-digit code it shows.
        </p>
        <p>
          <span className="text-sm text-fg-subtle">Setup key</span>
          <br />
          <code className="mt-1 inline-block rounded bg-surface px-3 py-2 font-mono break-all">{setup.secret}</code>
        </p>
        <p className="text-sm">
          <a href={setup.uri} className="underline underline-offset-4">Open in authenticator app</a>
        </p>
        <Field label="6-digit code" required error={errors.code}>
          {(p) => <Input {...p} name="code" autoComplete="one-time-code" inputMode="numeric" maxLength={10} />}
        </Field>
        <Button type="submit" disabled={pending} aria-disabled={pending}>Turn on two-step verification</Button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      {general && <FormAlert>{general}</FormAlert>}
      <p className="text-fg-muted">Add a second step to your sign-in with an authenticator app. This is optional: you can still sign in with your password alone.</p>
      <Button onClick={start} disabled={pending} aria-disabled={pending}>Set up two-step verification</Button>
    </div>
  );
}
