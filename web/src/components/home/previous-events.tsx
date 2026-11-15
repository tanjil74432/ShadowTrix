import Link from "next/link";
import { EventCard } from "@/components/event/event-card";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { SampleNotice } from "@/components/ui/sample-notice";
import { SectionHeading } from "@/components/ui/section-heading";
import { samplePastEvents } from "@/content/sample-data";

export function PreviousEvents() {
  return (
    <section aria-labelledby="previous-title" className="py-section">
      <Container>
        <SectionHeading
          id="previous-title"
          title="Previous events"
          description="Past events stay on the platform with their results and certificates."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/events">Browse all events</Link>
            </Button>
          }
        />
        <SampleNotice className="mt-8">
          Demonstration entries only. Real past events, results and achievements will be listed here after they take place.
        </SampleNotice>
        <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {samplePastEvents.map((event) => (
            <li key={event.slug} className="flex">
              <EventCard event={event} className="w-full" />
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
