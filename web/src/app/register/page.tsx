import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = {
  title: "Register",
  robots: { index: false, follow: true },
};

export default function Page() {
  return (
    <ComingSoon
      title="Registration is coming soon"
      description="Accounts are not available yet. You will be able to create an account here in a later release."
    />
  );
}
