import type { EventCategoryKey } from "@/lib/event-categories";

export type RegistrationStatus = "OPENS_SOON" | "OPEN" | "CLOSED" | "FULL" | "LIVE" | "ENDED" | "CANCELLED";

/**
 * Every event keeps these five phases distinct (registration, event, submission,
 * judging, results). Optional phases may be unscheduled.
 */
export interface EventTimeline {
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  startsAt: Date;
  endsAt: Date;
  submissionDeadline?: Date | null;
  judgingStartsAt?: Date | null;
  judgingEndsAt?: Date | null;
  resultsAnnouncementAt?: Date | null;
}

export interface EventSummary {
  slug: string;
  title: string;
  category: EventCategoryKey;
  summary: string;
  coverImageUrl?: string | null;
  timezone: string;
  timeline: EventTimeline;
  status: RegistrationStatus;
  /** Detail page link. Omitted for sample events, which have no detail page. */
  href?: string;
  /** True for demonstration content that must never be mistaken for a real event. */
  isSample?: boolean;
}
