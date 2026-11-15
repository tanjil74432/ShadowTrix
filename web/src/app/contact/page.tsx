import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = {
  title: "Contact",
  robots: { index: false, follow: true },
};

export default function Page() {
  return (
    <ComingSoon
      title="The contact page is coming soon"
      description="A contact form will be available here. Until then, please check back soon."
    />
  );
}
