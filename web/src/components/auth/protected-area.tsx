import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { requirePageAccess } from "@/server/modules/auth/dal";
import { hasAnyRole, type Permission, type Role } from "@/server/modules/authz/permissions";

export function AccessDenied({ area }: { area: string }) {
  return (
    <Container className="py-24 sm:py-32">
      <p className="text-sm font-medium text-fg-muted">Access denied</p>
      <h1 className="mt-3 max-w-2xl text-h1 font-semibold text-balance">You do not have access to {area}</h1>
      <p className="mt-5 max-w-xl text-body-lg text-fg-muted text-pretty">
        Your account does not have the role required for this area. If you think this is a mistake, contact an administrator.
      </p>
      <div className="mt-10">
        <Button asChild size="lg">
          <Link href="/dashboard">Go to your dashboard</Link>
        </Button>
      </div>
    </Container>
  );
}

/**
 * Server-side gate for a page. Anonymous visitors are redirected to login; signed-in users without the permission
 * get the access-denied view and the protected children are never rendered, so no protected data is fetched or sent.
 * Must render inside <Suspense> (it reads the session).
 */
export async function ProtectedArea({
  permission,
  anyRole,
  returnTo,
  area,
  children,
}: {
  /** Platform-wide permission check (global grants only). */
  permission?: Permission;
  /** Alternative: the user holds this role in any scope (event-scoped judges and organizers). Resources are still checked one by one. */
  anyRole?: Role;
  returnTo: string;
  area: string;
  children: ReactNode;
}) {
  if (anyRole) {
    const { requireUser } = await import("@/server/modules/auth/dal");
    const user = await requireUser(returnTo);
    return hasAnyRole(user, anyRole) ? <>{children}</> : <AccessDenied area={area} />;
  }
  const { allowed } = await requirePageAccess(permission as Permission, returnTo);
  if (!allowed) return <AccessDenied area={area} />;
  return <>{children}</>;
}
