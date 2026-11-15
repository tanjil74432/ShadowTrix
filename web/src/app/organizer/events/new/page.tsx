import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ProtectedArea } from "@/components/auth/protected-area";
import { EventForm } from "@/components/organizer/event-form";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Create event", robots: { index: false, follow: false } };

export default function NewEventPage() {
  return (
    <Suspense fallback={<Container className="py-14"><Skeleton className="h-96 w-full" /></Container>}>
      <ProtectedArea permission="event:manage" returnTo="/organizer/events/new" area="event creation">
        <Container className="max-w-3xl py-14 sm:py-20">
          <p className="text-sm"><Link href="/organizer" className="underline underline-offset-4 text-fg-muted">Organizer dashboard</Link></p>
          <h1 className="mt-4 text-h1 font-semibold">Create event</h1>
          <p className="mt-2 mb-10 text-fg-muted">The event is saved as a draft. Nobody can see it until you publish it.</p>
          <EventForm mode="create" />
        </Container>
      </ProtectedArea>
    </Suspense>
  );
}

