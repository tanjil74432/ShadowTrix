import Link from "next/link";
import { EventCard } from "@/components/event/event-card";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { SampleNotice } from "@/components/ui/sample-notice";
import { SectionHeading } from "@/components/ui/section-heading";
import { sampleUpcomingEvents } from "@/content/sample-data";

export function FeaturedEvents() {
  return (
    <section aria-labelledby="featured-title" className="py-section">
      <Container>
        <SectionHeading
          id="featured-title"
          title="Featured upcoming events"
          description="Each event lists its registration period, event dates, submission deadline, judging period and result announcement separately."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/events">View all events</Link>
            </Button>
          }
        />
        <SampleNotice className="mt-8">
          The events below are demonstrations of the card design. They are not real events and cannot be registered for.
          Live events will appear here once organizers publish them.
        </SampleNotice>
        <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {sampleUpcomingEvents.map((event) => (
            <li key={event.slug} className="flex">
              <EventCard event={event} className="w-full" />
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
