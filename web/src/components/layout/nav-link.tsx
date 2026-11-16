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
        "relative rounded-md px-3 py-2 text-sm font-medium transition-colors duration-(--duration-fast)",
        "after:absolute after:inset-x-3 after:-bottom-0.5 after:h-0.5 after:origin-left after:scale-x-0 after:rounded-full after:bg-accent after:transition-transform after:duration-(--duration-base) hover:after:scale-x-100 motion-reduce:after:transition-none",
        active ? "text-fg after:scale-x-100" : "text-fg-muted hover:text-accent-soft",
        className,
      )}
      {...props}
    />
  );
}
