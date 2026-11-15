import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = {
  title: "Events",
  robots: { index: false, follow: true },
};

export default function Page() {
  return (
    <ComingSoon
      title="Event listings are coming soon"
      description="Published events will be listed here with filters for format, technology domain and registration status."
    />
  );
}
