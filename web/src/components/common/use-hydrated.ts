"use client";

import { useSyncExternalStore } from "react";

/**
 * False while the page is server-rendered and until React has attached its event handlers, true afterwards (never changes back).
 * Buttons that run an action are disabled until then: a tap on a server-rendered button before hydration would otherwise be lost
 * silently, which happens on slow phones and busy machines.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}
