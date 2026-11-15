"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDownIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { nav } from "@/lib/site";

/** "About Us" dropdown (About ShadowTrix, Our Team). Keyboard: Enter/Space/Arrow opens, arrows move, Esc closes. */
export function AboutMenu() {
  const pathname = usePathname();
  const inSection = pathname === "/about" || pathname.startsWith("/about/");

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-(--duration-fast)",
          "data-[state=open]:text-fg",
          inSection ? "text-fg" : "text-fg-muted hover:text-fg",
        )}
      >
        {nav.about.label}
        <ChevronDownIcon className="size-4 transition-transform duration-(--duration-fast) [[data-state=open]_&]:rotate-180 motion-reduce:transition-none" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="start"
          sideOffset={8}
          className="z-50 w-72 rounded-lg bg-surface-raised p-1.5 shadow-overlay"
        >
          {nav.about.items.map((item) => (
            <Menu.Item key={item.href} asChild>
              <Link
                href={item.href}
                aria-current={pathname === item.href ? "page" : undefined}
                className="block rounded-md px-3 py-2.5 outline-none data-[highlighted]:bg-border"
              >
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="mt-0.5 block text-sm text-fg-muted">{item.description}</span>
              </Link>
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
