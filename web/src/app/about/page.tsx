import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = {
  title: "About ShadowTrix",
  robots: { index: false, follow: true },
};

export default function Page() {
  return (
    <ComingSoon
      title="The About page is coming soon"
      description="We are still writing this page. It will describe the platform, how it works and who it is for."
    />
  );
}
