import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LogoutButton } from "@/components/auth/logout-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { ROLE_LABEL } from "@/lib/roles";
import { requireUser } from "@/server/modules/auth/dal";
import { can } from "@/server/modules/authz/permissions";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false, follow: false } };

export default function DashboardPage() {
  return (
    <Container className="py-14 sm:py-20">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <DashboardContent />
      </Suspense>
    </Container>
  );
}

async function DashboardContent() {
  const user = await requireUser("/dashboard");
  const roles = [...new Set(user.roles.map((r) => r.role))];
  const areas = [
    { href: "/organizer", label: "Organizer area", show: can(user, "event:manage") },
    { href: "/judge", label: "Judge area", show: can(user, "event:judge") },
    { href: "/admin", label: "Administration", show: can(user, "admin:access") },
  ].filter((a) => a.show);

  return (
    <>
      <p className="text-sm font-medium text-fg-muted">Signed in</p>
      <h1 className="mt-2 text-h1 font-semibold text-balance">Welcome, {user.fullName}</h1>

      <dl className="mt-10 grid max-w-2xl gap-6 rounded-lg bg-surface p-6 shadow-card sm:grid-cols-2">
        <div>
          <dt className="text-sm text-fg-subtle">Email address</dt>
          <dd className="mt-1 font-medium break-all">{user.email}</dd>
        </div>
        <div>
          <dt className="text-sm text-fg-subtle">Roles</dt>
          <dd className="mt-1 flex flex-wrap gap-2">
            {roles.map((r) => (
              <Badge key={r} className="text-fg">
                {ROLE_LABEL[r] ?? r}
              </Badge>
            ))}
          </dd>
        </div>
      </dl>

      {areas.length > 0 && (
        <nav aria-label="Your areas" className="mt-8 flex flex-wrap gap-3">
          {areas.map((a) => (
            <Button key={a.href} asChild variant="secondary">
              <Link href={a.href}>{a.label}</Link>
            </Button>
          ))}
        </nav>
      )}

      <p className="mt-10 max-w-2xl text-fg-muted text-pretty">
        Event registration, teams and submissions will appear here as they are released. For now this page confirms that your account and roles are working.
      </p>
      <div className="mt-8">
        <LogoutButton />
      </div>
    </>
  );
}
