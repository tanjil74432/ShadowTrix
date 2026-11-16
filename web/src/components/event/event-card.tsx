import Image from "next/image";
import Link from "next/link";
import { CategoryBadge, SampleBadge } from "@/components/ui/badge";
import { ArrowRightIcon, CalendarIcon, ClockIcon } from "@/components/ui/icons";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/cn";
import { formatDate, formatDateRange } from "@/lib/format";
import type { EventSummary } from "@/types/event";
import { CategoryCover } from "./category-cover";

interface EventCardProps {
  event: EventSummary;
  /** Heading level for the title, so the card fits the surrounding outline. */
  headingLevel?: "h2" | "h3" | "h4";
  className?: string;
}

/**
 * One consistent event card: cover, category, status, title, summary, the two dates people
 * look for first (event and registration deadline) and a details action.
 * The whole card is clickable through a single link (no nested interactive elements).
 */
export function EventCard({ event, headingLevel: Heading = "h3", className }: EventCardProps) {
  const { timeline: t, timezone: tz } = event;
  const hasDetails = !!event.href;

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg bg-surface shadow-card",
        "transition-[box-shadow,transform] duration-(--duration-base) ease-out-soft",
        hasDetails && "hover:-translate-y-1 hover:shadow-card-hover focus-within:-translate-y-1 focus-within:shadow-card-hover motion-reduce:hover:translate-y-0 motion-reduce:focus-within:translate-y-0",
        className,
      )}
    >
      <div className="relative aspect-video overflow-hidden border-b border-accent/25 bg-surface-raised">
        {event.coverImageUrl ? (
          <Image
            src={event.coverImageUrl}
            alt=""
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover"
          />
        ) : (
          <CategoryCover
            seed={event.slug}
            className="transition-transform duration-(--duration-slow) ease-out-soft group-hover:scale-[1.03] motion-reduce:transition-none"
          />
        )}
        <div className="absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
          <CategoryBadge category={event.category} />
          <StatusBadge status={event.status} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <Heading className="text-h3 font-semibold text-balance transition-colors duration-(--duration-fast) group-hover:text-accent-soft">{event.title}</Heading>
            {event.isSample && <SampleBadge className="mt-1 shrink-0" />}
          </div>
          <p className="line-clamp-3 text-fg-muted text-pretty">{event.summary}</p>
        </div>

        <dl className="panel-orange mt-auto grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg px-3.5 py-3 text-sm">
          <div>
            <dt className="flex items-center gap-1.5 text-silver/85">
              <CalendarIcon className="text-accent" />
              Event date
            </dt>
            <dd className="mt-0.5 font-semibold text-accent-soft">
              <time dateTime={t.startsAt.toISOString()}>{formatDateRange(t.startsAt, t.endsAt, tz)}</time>
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-silver/85">
              <ClockIcon className="text-accent" />
              Register by
            </dt>
            <dd className="mt-0.5 font-semibold text-accent">
              <time dateTime={t.registrationClosesAt.toISOString()}>{formatDate(t.registrationClosesAt, tz)}</time>
            </dd>
          </div>
        </dl>

        {hasDetails ? (
          <Link
            href={event.href!}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-soft after:absolute after:inset-0 after:content-['']"
          >
            View details
            <span className="sr-only"> for {event.title}</span>
            <ArrowRightIcon className="transition-transform duration-(--duration-fast) group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </Link>
        ) : (
          <p className="text-sm text-fg-subtle">{event.isSample ? "Sample entry: no detail page." : "Details coming soon."}</p>
        )}
      </div>
    </article>
  );
}
