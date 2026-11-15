import Link from "next/link";
import { can, type Actor } from "@/server/modules/authz/permissions";

/**
 * Role-aware navigation for the account areas. Links are shown only for areas the user can open; the pages
 * themselves still enforce access on the server, so hiding a link is a convenience, not the protection.
 */
export function AreaNav({ user, current }: { user: Actor; current: "overview" | "settings" | "organizer" }) {
  const items = [
    { key: "overview", href: "/dashboard", label: "My dashboard", show: true },
    { key: "settings", href: "/dashboard/settings", label: "Account settings", show: true },
    { key: "organizer", href: "/organizer", label: "Organizer dashboard", show: can(user, "event:manage") },
    { key: "judge", href: "/judge", label: "Judge area", show: can(user, "event:judge") },
    { key: "admin", href: "/admin", label: "Administration", show: can(user, "admin:access") },
  ].filter((i) => i.show);
  return (
    <nav aria-label="Account areas" className="-mx-1 mb-8 flex flex-wrap gap-1 border-b border-border pb-3">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === current ? "page" : undefined}
          className="rounded-md px-3 py-2 text-sm font-medium text-fg-muted hover:text-fg aria-[current=page]:bg-surface-raised aria-[current=page]:text-fg"
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
