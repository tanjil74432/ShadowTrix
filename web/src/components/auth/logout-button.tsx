"use client";

import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { sendJson } from "./api";

/** Ends the session on the server (revokes it), then does a full navigation so every page re-renders signed out. */
export function LogoutButton(props: Omit<ButtonProps, "onClick" | "children">) {
  const [pending, setPending] = useState(false);
  async function logout() {
    setPending(true);
    await sendJson("/api/v1/auth/logout");
    // A full page load on purpose: the client router cache must not keep any signed-in UI after the session ends.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
  }
  return (
    <Button variant="secondary" {...props} onClick={logout} disabled={pending} aria-disabled={pending}>
      {pending ? "Signing out" : "Sign out"}
    </Button>
  );
}
