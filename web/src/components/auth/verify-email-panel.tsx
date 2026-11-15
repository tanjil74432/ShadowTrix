"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { rateLimitMessage, sendJson, type ApiResult } from "./api";
import { FormAlert, ResultPanel } from "./form-parts";
import { ResendVerificationForm } from "./resend-verification-form";

/**
 * The emailed link opens this page; the token is only used when the person presses the button (a POST).
 * That stops mail scanners and link previewers, which fetch URLs automatically, from consuming a single-use token.
 */
export function VerifyEmailPanel() {
  const token = useSearchParams().get("token") ?? "";
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [done, setDone] = useState(false);

  async function confirm() {
    setPending(true);
    const res = await sendJson("/api/v1/auth/verify-email", { token });
    setPending(false);
    if (res.ok) setDone(true);
    else setResult(res);
  }

  if (done) {
    return (
      <ResultPanel title="Email address confirmed">
        <p>Your account is ready.</p>
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

  return (
    <div className="space-y-5">
      {result && !result.ok && <FormAlert>{result.status === 429 ? rateLimitMessage(result.retryAfterSeconds) : result.message}</FormAlert>}
      <p className="text-fg-muted">Press the button to confirm your email address and activate your account.</p>
      <Button size="lg" className="w-full" onClick={confirm} disabled={pending} aria-disabled={pending}>
        {pending ? "Confirming" : "Confirm email address"}
      </Button>
    </div>
  );
}
