import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";
import { Button } from "@/components/ui/button";
import { nav } from "@/lib/site";
import { getCurrentUser } from "@/server/modules/auth/dal";
import { NavLink } from "./nav-link";

/**
 * Header actions that depend on the session. Reads the session on the server (validated against the database),
 * so a revoked or expired session shows the signed-out header immediately. Must render inside <Suspense>.
 */
export async function AccountActions() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <NavLink href={nav.account.login.href} className="hidden md:inline-block">
          {nav.account.login.label}
        </NavLink>
        <Button asChild size="sm" className="hidden shadow-glow-soft md:inline-flex">
          <Link href={nav.account.register.href}>{nav.account.register.label}</Link>
        </Button>
      </>
    );
  }
  return (
    <>
      <NavLink href="/dashboard" className="hidden md:inline-block">
        Dashboard
      </NavLink>
      <LogoutButton variant="secondary" size="sm" className="hidden md:inline-flex" />
    </>
  );
}

export async function MobileAccountActions() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <Button asChild variant="secondary" size="lg">
          <Link href={nav.account.login.href}>{nav.account.login.label}</Link>
        </Button>
        <Button asChild size="lg">
          <Link href={nav.account.register.href}>{nav.account.register.label}</Link>
        </Button>
      </>
    );
  }
  return (
    <>
      <Button asChild variant="secondary" size="lg">
        <Link href="/dashboard">Dashboard</Link>
      </Button>
      <LogoutButton size="lg" />
    </>
  );
}
