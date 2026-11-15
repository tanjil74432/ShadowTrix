import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/server/modules/auth/dal";

/** Signed-in visitors are sent to their dashboard instead of seeing login/register forms. Render inside <Suspense>. */
export async function GuestOnly({ children }: { children: ReactNode }) {
  if (await getCurrentUser()) redirect("/dashboard");
  return <>{children}</>;
}
