import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthCard, FormSkeleton } from "@/components/auth/auth-card";
import { GuestOnly } from "@/components/auth/guest-only";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Log in", robots: { index: false, follow: false } };

export default function LoginPage() {
  return (
    <AuthCard
      title="Log in"
      description="Welcome back. Log in to manage your registrations and submissions."
      footer={
        <p>
          New to ShadowTrix?{" "}
          <Link href="/register" className="font-medium text-fg underline underline-offset-4">
            Create an account
          </Link>
        </p>
      }
    >
      <Suspense fallback={<FormSkeleton />}>
        <GuestOnly>
          <LoginForm />
        </GuestOnly>
      </Suspense>
    </AuthCard>
  );
}
