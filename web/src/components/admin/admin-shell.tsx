import Link from "next/link";
import type { ReactNode } from "react";
import { ProtectedArea } from "@/components/auth/protected-area";
import { Container } from "@/components/ui/container";

const NAV = [
  { key: "overview", href: "/admin", label: "Overview" },
  { key: "users", href: "/admin/users", label: "Users" },
  { key: "events", href: "/admin/events", label: "Events" },
  { key: "organizations", href: "/admin/organizations", label: "Organizations" },
  { key: "leadership", href: "/admin/leadership", label: "Leadership" },
  { key: "analytics", href: "/admin/analytics", label: "Analytics" },
  { key: "audit", href: "/admin/audit", label: "Audit and security" },
  { key: "settings", href: "/admin/settings", label: "Settings" },
] as const;

export type AdminSection = (typeof NAV)[number]["key"];

/**
 * Every administration page renders inside this: the server-side access check first (nothing below renders for anyone but an
 * administrator, so no admin data is fetched for others), then the section navigation.
 */
export function AdminShell({ section, returnTo, children }: { section: AdminSection; returnTo: string; children: ReactNode }) {
  return (
    <ProtectedArea permission="admin:access" returnTo={returnTo} area="administration">
      <Container className="py-10 sm:py-14 lg:grid lg:grid-cols-[14.5rem_minmax(0,1fr)] lg:items-start lg:gap-10">
        <nav
          aria-label="Administration sections"
          className="mb-8 flex gap-1 overflow-x-auto glass rounded-xl p-1 [scrollbar-width:thin] lg:sticky lg:top-24 lg:mb-0 lg:flex-col lg:overflow-visible lg:p-2"
        >
          {NAV.map((n) => (
            <Link
              key={n.key}
              href={n.href}
              aria-current={n.key === section ? "page" : undefined}
              className="relative shrink-0 rounded-lg px-3.5 py-2.5 text-sm font-medium whitespace-nowrap text-fg-muted transition-[color,background-color] duration-(--duration-fast) before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:origin-center before:scale-y-0 before:rounded-full before:bg-accent before:transition-transform before:duration-(--duration-base) hover:bg-accent-wash/70 hover:text-accent-soft aria-[current=page]:bg-accent-wash aria-[current=page]:text-accent-soft aria-[current=page]:before:scale-y-100 motion-reduce:before:transition-none"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="min-w-0">{children}</div>
      </Container>
    </ProtectedArea>
  );
}
