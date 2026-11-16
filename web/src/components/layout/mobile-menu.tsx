"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { CloseIcon, MenuIcon } from "@/components/ui/icons";
import { nav, site } from "@/lib/site";

const linkClass = "block rounded-lg px-3 py-3 text-lg font-medium text-fg transition-colors duration-(--duration-fast) hover:bg-accent-wash hover:text-accent-soft";

/**
 * Full-height dialog menu for small screens. Radix provides focus trapping, Escape to close and focus return.
 * `account` is server-rendered (it depends on the session) and passed in, so this client component never sees session data.
 */
export function MobileMenu({ account }: { account: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const close = () => setOpen(false);

  // Any navigation (including links rendered by the server inside the account slot) closes the menu.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing UI with an external system (the URL)
    setOpen(false);
  }, [pathname]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open menu" className="md:hidden">
          <MenuIcon className="size-6" />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/75 backdrop-blur-[2px] data-[state=open]:animate-[page-in_160ms_ease-out_both]" />
        <Dialog.Content
          className="glass fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-r-0 border-y-0 p-4"
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

          {/* Links here are rendered by the server and cannot call close(); closing on any link click also covers
              "link to the page you are already on", where the URL (and so the effect above) does not change. */}
          <div
            className="mt-4 grid gap-3 border-t border-border pt-4"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a")) close();
            }}
          >
            {account}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
