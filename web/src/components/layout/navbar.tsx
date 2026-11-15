import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { nav } from "@/lib/site";
import { AboutMenu } from "./about-menu";
import { BrandLogo } from "./brand-logo";
import { MobileMenu } from "./mobile-menu";
import { NavLink } from "./nav-link";

/**
 * Site header. One emphasized action (Register); Login is a quiet text link, so sign-in lives in the
 * navigation and not in the hero. Desktop shows inline links; below md the same links move into a dialog menu.
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
          <NavLink href={nav.account.login.href} className="hidden md:inline-block">
            {nav.account.login.label}
          </NavLink>
          <Button asChild size="sm" className="hidden md:inline-flex">
            <Link href={nav.account.register.href}>{nav.account.register.label}</Link>
          </Button>
          <MobileMenu />
        </div>
      </Container>
    </header>
  );
}
