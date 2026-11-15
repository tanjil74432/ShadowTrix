import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard, FormSkeleton } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: false } };

export default function ResetPasswordPage() {
  return (
    <AuthCard title="Choose a new password" description="Pick a password you do not use anywhere else. Every device will be signed out when you save it.">
      <Suspense fallback={<FormSkeleton />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthCard>
  );
}
