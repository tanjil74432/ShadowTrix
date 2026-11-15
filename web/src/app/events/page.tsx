import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { EventCard } from "@/components/event/event-card";
import { EventFilters } from "@/components/event/event-filters";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { EventCardSkeleton } from "@/components/ui/skeleton";
import { EVENT_CATEGORIES } from "@/lib/event-categories";
import { toEventSummary } from "@/lib/event-mapping";
import { listEventsQuerySchema } from "@/server/modules/events/event.schema";
import { listPublicEvents } from "@/server/modules/events/events.service";

export const metadata: Metadata = {
  title: "Events",
  description: "Browse published ShadowTrix events: hackathons, datathons, AI and ML competitions, programming contests, workshops and summits.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function EventsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Container className="py-14 sm:py-20">
      <h1 className="text-h1 font-semibold text-balance">Events</h1>
      <p className="mt-3 max-w-2xl text-fg-muted text-pretty">Every event listed here has been published by its organizers. Dates are shown in UTC.</p>
      <Suspense fallback={<ListSkeleton />}>
        <EventResults searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

function ListSkeleton() {
  return (
    <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <EventCardSkeleton key={i} />
      ))}
    </div>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function EventResults({ searchParams }: { searchParams: SearchParams }) {
  await connection(); // statuses depend on the current time
  const raw = await searchParams;
  const parsed = listEventsQuerySchema.safeParse({ q: first(raw.q) || undefined, category: first(raw.category) || undefined, page: first(raw.page) || undefined });
  // Invalid filters are ignored rather than shown as errors: the page still lists events.
  const query = parsed.success ? parsed.data : listEventsQuerySchema.parse({});
  const { items, total, page, pageSize } = await listPublicEvents(query);
  const now = new Date();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const link = (p: number) => {
    const sp = new URLSearchParams();
    if (query.q) sp.set("q", query.q);
    if (query.category) sp.set("category", query.category);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/events?${s}` : "/events";
  };
  const filtered = !!(query.q || query.category);

  return (
    <>
      <div className="mt-8">
        <EventFilters q={query.q} category={query.category} />
      </div>
      <p className="mt-6 text-sm text-fg-muted" role="status">
        {total === 0 ? "No events found." : `${total} ${total === 1 ? "event" : "events"}${query.category ? ` in ${EVENT_CATEGORIES[query.category].label}` : ""}.`}
      </p>
      {items.length === 0 ? (
        <EmptyState
          className="mt-6"
          title={filtered ? "No events match your search" : "No events are published yet"}
          description={filtered ? "Try a different keyword or clear the filters." : "Published events will appear here. Check back soon."}
          action={filtered ? <Button asChild variant="secondary"><Link href="/events">Clear filters</Link></Button> : undefined}
        />
      ) : (
        <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((e) => (
            <li key={e.id} className="flex">
              <EventCard event={toEventSummary(e, now)} headingLevel="h2" className="w-full" />
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav aria-label="Pagination" className="mt-10 flex items-center justify-between gap-4">
          {page > 1 ? (
            <Button asChild variant="secondary">
              <Link href={link(page - 1)} rel="prev">Previous</Link>
            </Button>
          ) : (
            <span />
          )}
          <span className="text-sm text-fg-muted">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Button asChild variant="secondary">
              <Link href={link(page + 1)} rel="next">Next</Link>
            </Button>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
