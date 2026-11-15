"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CloseIcon, MenuIcon } from "@/components/ui/icons";
import { nav, site } from "@/lib/site";

const linkClass = "block rounded-md px-3 py-3 text-lg font-medium text-fg hover:bg-surface-raised";

/** Full-height dialog menu for small screens. Radix provides focus trapping, Escape to close and focus return. */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open menu" className="md:hidden">
          <MenuIcon className="size-6" />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80" />
        <Dialog.Content
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col bg-surface p-4 shadow-overlay"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="px-3 text-sm font-medium text-fg-muted">{site.name} menu</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close menu">
                <CloseIcon className="size-6" />
              </Button>
            </Dialog.Close>
          </div>

          <nav aria-label="Mobile" className="mt-4 flex-1 overflow-y-auto">
            <ul className="space-y-1">
              {nav.primary.slice(0, 1).map((l) => (
                <li key={l.href}>
                  <Link href={l.href} onClick={close} className={linkClass}>
                    {l.label}
                  </Link>
                </li>
              ))}
              <li>
                <p className="px-3 pt-3 pb-1 text-sm text-fg-subtle">{nav.about.label}</p>
                <ul className="space-y-1">
                  {nav.about.items.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} onClick={close} className={linkClass}>
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
              {nav.primary.slice(1).map((l) => (
                <li key={l.href}>
                  <Link href={l.href} onClick={close} className={linkClass}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="mt-4 grid gap-3 border-t border-border pt-4">
            <Button asChild variant="secondary" size="lg">
              <Link href={nav.account.login.href} onClick={close}>
                {nav.account.login.label}
              </Link>
            </Button>
            <Button asChild size="lg">
              <Link href={nav.account.register.href} onClick={close}>
                {nav.account.register.label}
              </Link>
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
