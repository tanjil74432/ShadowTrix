import type { ReactNode } from "react";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";

/** Shared layout for the account pages: one H1, a short description, then the form. */
export function AuthCard({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <section aria-labelledby="auth-title" className="relative isolate overflow-hidden">
      <div aria-hidden className="bg-grid mask-fade absolute inset-0 -z-10" />
      <Container className="py-14 sm:py-20">
        <div className="mx-auto w-full max-w-md">
          <h1 id="auth-title" className="text-h1 font-semibold text-balance">
            {title}
          </h1>
          {description && <p className="mt-3 text-fg-muted text-pretty">{description}</p>}
          <div className="mt-8 rounded-lg bg-surface p-6 shadow-card sm:p-8">{children}</div>
          {footer && <div className="mt-6 text-sm text-fg-muted">{footer}</div>}
        </div>
      </Container>
    </section>
  );
}

export function FormSkeleton() {
  return (
    <div role="status" aria-label="Loading form" className="space-y-5">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}
