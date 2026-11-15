import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = {
  title: "Community",
  robots: { index: false, follow: true },
};

export default function Page() {
  return (
    <ComingSoon
      title="The community page is coming soon"
      description="This page will describe how participants, mentors, judges and partners can get involved."
    />
  );
}
