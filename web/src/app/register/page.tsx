import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthCard, FormSkeleton } from "@/components/auth/auth-card";
import { GuestOnly } from "@/components/auth/guest-only";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Create an account", robots: { index: false, follow: false } };

export default function RegisterPage() {
  return (
    <AuthCard
      title="Create an account"
      description="Enter your email address. We will send a link to confirm it, and you choose your password after that."
      footer={
        <p>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-fg underline underline-offset-4">
            Log in
          </Link>
        </p>
      }
    >
      <Suspense fallback={<FormSkeleton />}>
        <GuestOnly>
          <RegisterForm />
        </GuestOnly>
      </Suspense>
    </AuthCard>
  );
}
