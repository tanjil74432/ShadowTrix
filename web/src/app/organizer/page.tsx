import type { Metadata } from "next";
import { Suspense } from "react";
import { ProtectedArea } from "@/components/auth/protected-area";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Organizer area", robots: { index: false, follow: false } };

export default function OrganizerPage() {
  return (
    <Suspense fallback={<Container className="py-14"><Skeleton className="h-40 w-full" /></Container>}>
      <ProtectedArea permission="event:manage" returnTo="/organizer" area="the organizer area">
        <Container className="py-14 sm:py-20">
          <h1 className="text-h1 font-semibold">Organizer area</h1>
          <p className="mt-3 max-w-2xl text-fg-muted text-pretty">
            Access confirmed. Creating and managing events arrives in a later release; this page only demonstrates that the organizer role is enforced.
          </p>
        </Container>
      </ProtectedArea>
    </Suspense>
  );
}
