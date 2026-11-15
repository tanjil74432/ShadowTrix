import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthCard, FormSkeleton } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email address you registered with and we will send you a link to choose a new password."
      footer={
        <p>
          Remembered it?{" "}
          <Link href="/login" className="font-medium text-fg underline underline-offset-4">
            Back to login
          </Link>
        </p>
      }
    >
      <Suspense fallback={<FormSkeleton />}>
        <ForgotPasswordForm />
      </Suspense>
    </AuthCard>
  );
}
