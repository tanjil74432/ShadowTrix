import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = {
  title: "Our Team",
  robots: { index: false, follow: true },
};

export default function Page() {
  return (
    <ComingSoon
      title="The team page is coming soon"
      description="The leadership board and working teams will be listed here once their details have been verified."
    />
  );
}
