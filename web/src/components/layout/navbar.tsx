import { Suspense } from "react";
import { Container } from "@/components/ui/container";
import { nav } from "@/lib/site";
import { AboutMenu } from "./about-menu";
import { AccountActions, MobileAccountActions } from "./account-actions";
import { BrandLogo } from "./brand-logo";
import { MobileMenu } from "./mobile-menu";
import { NavLink } from "./nav-link";

/**
 * Site header. One emphasized action; sign-in lives in the navigation, not in the hero. Desktop shows inline links;
 * below md the same links move into a dialog menu. Everything that depends on the session streams in behind
 * <Suspense>, so the rest of every page stays statically prerendered.
 */
export function Navbar() {
  const [events, ...rest] = nav.primary;
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur-sm supports-[backdrop-filter]:bg-bg/80">
      <Container className="flex h-16 items-center justify-between gap-6">
        <BrandLogo />

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          <NavLink href={events.href}>{events.label}</NavLink>
          <AboutMenu />
          {rest.map((l) => (
            <NavLink key={l.href} href={l.href}>
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Suspense fallback={<div aria-hidden className="h-9 w-24 md:w-40" />}>
            <AccountActions />
          </Suspense>
          <MobileMenu
            account={
              <Suspense fallback={null}>
                <MobileAccountActions />
              </Suspense>
            }
          />
        </div>
      </Container>
    </header>
  );
}
