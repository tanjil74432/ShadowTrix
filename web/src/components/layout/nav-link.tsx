"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/** Link that marks itself as the current page (aria-current) for assistive tech and styling. */
export function NavLink({ href, className, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-2 text-sm font-medium transition-colors duration-(--duration-fast)",
        active ? "text-fg" : "text-fg-muted hover:text-fg",
        className,
      )}
      {...props}
    />
  );
}
