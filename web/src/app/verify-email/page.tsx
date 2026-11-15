import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard, FormSkeleton } from "@/components/auth/auth-card";
import { VerifyEmailPanel } from "@/components/auth/verify-email-panel";

export const metadata: Metadata = { title: "Confirm your email", robots: { index: false, follow: false } };

export default function VerifyEmailPage() {
  return (
    <AuthCard title="Confirm your email" description="One last step before your account is active.">
      <Suspense fallback={<FormSkeleton />}>
        <VerifyEmailPanel />
      </Suspense>
    </AuthCard>
  );
}
