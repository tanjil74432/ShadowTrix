import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = {
  title: "Login",
  robots: { index: false, follow: true },
};

export default function Page() {
  return (
    <ComingSoon
      title="Login is coming soon"
      description="Accounts are not available yet. Registration and sign-in will open in a later release."
    />
  );
}
