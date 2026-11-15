import { deriveEventStatus } from "@/lib/event-status";
import type { EventCategoryKey } from "@/lib/event-categories";
import type { EventSummary } from "@/types/event";

interface MappableEvent {
  slug: string;
  title: string;
  category: string;
  summary: string;
  coverImageUrl: string | null;
  timezone: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  submissionDeadline: Date | null;
  judgingStartsAt: Date | null;
  judgingEndsAt: Date | null;
  resultsAnnouncementAt: Date | null;
  registrationManuallyClosed: boolean;
  capacity: number | null;
  confirmedCount: number;
}

/** Database event -> the card/timeline shape. `now` is passed in so the caller decides when the clock is read. */
export function toEventSummary(e: MappableEvent, now: Date): EventSummary {
  const timeline = {
    registrationOpensAt: e.registrationOpensAt,
    registrationClosesAt: e.registrationClosesAt,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    submissionDeadline: e.submissionDeadline,
    judgingStartsAt: e.judgingStartsAt,
    judgingEndsAt: e.judgingEndsAt,
    resultsAnnouncementAt: e.resultsAnnouncementAt,
  };
  return {
    slug: e.slug,
    title: e.title,
    category: e.category as EventCategoryKey,
    summary: e.summary,
    coverImageUrl: e.coverImageUrl,
    timezone: e.timezone,
    timeline,
    status: deriveEventStatus({
      timeline,
      now,
      cancelled: e.status === "CANCELLED",
      registrationManuallyClosed: e.registrationManuallyClosed,
      capacity: e.capacity,
      confirmedCount: e.confirmedCount,
    }),
    href: `/events/${e.slug}`,
  };
}
