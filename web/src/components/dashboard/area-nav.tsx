import Link from "next/link";
import { can, hasAnyRole, type Actor } from "@/server/modules/authz/permissions";

/**
 * Role-aware navigation for the account areas. Links are shown only for areas the user can open; the pages
 * themselves still enforce access on the server, so hiding a link is a convenience, not the protection.
 */
export function AreaNav({ user, current }: { user: Actor; current: "overview" | "settings" | "banner" | "organizer" | "judge" }) {
  const items = [
    { key: "overview", href: "/dashboard", label: "My dashboard", show: true },
    { key: "settings", href: "/dashboard/settings", label: "Account settings", show: true },
    { key: "banner", href: "/dashboard/banner", label: "Banner creator", show: true },
    { key: "organizer", href: "/organizer", label: "Organizer dashboard", show: can(user, "event:manage") || hasAnyRole(user, "ORGANIZER") },
    { key: "judge", href: "/judge", label: "Judge area", show: can(user, "event:judge") || hasAnyRole(user, "JUDGE") },
    { key: "admin", href: "/admin", label: "Administration", show: can(user, "admin:access") },
  ].filter((i) => i.show);
  return (
    <nav aria-label="Account areas" className="mb-8 flex gap-1 overflow-x-auto glass-soft rounded-xl p-1 [scrollbar-width:thin]">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === current ? "page" : undefined}
          className="shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap text-fg-muted transition-[color,background-color,box-shadow] duration-(--duration-fast) hover:bg-accent-wash/70 hover:text-accent-soft aria-[current=page]:bg-accent-wash aria-[current=page]:text-accent-soft aria-[current=page]:shadow-[inset_0_0_0_1px_rgb(240_120_50/0.45),0_0_16px_-4px_rgb(240_120_50/0.35)]"
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
