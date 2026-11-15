import type { EventTimeline, RegistrationStatus } from "@/types/event";

export interface StatusInput {
  timeline: Pick<EventTimeline, "registrationOpensAt" | "registrationClosesAt" | "startsAt" | "endsAt">;
  now: Date;
  cancelled?: boolean;
  registrationManuallyClosed?: boolean;
  capacity?: number | null;
  confirmedCount?: number;
}

/**
 * Single source of truth for the status shown on cards and pages.
 * Precedence: cancelled > ended > live > registration state.
 * Registration state: not yet open -> OPENS_SOON; closed (by date or by an organizer) -> CLOSED;
 * capacity reached -> FULL; otherwise OPEN.
 */
export function deriveEventStatus(input: StatusInput): RegistrationStatus {
  const { timeline: t, now } = input;
  if (input.cancelled) return "CANCELLED";
  if (now >= t.endsAt) return "ENDED";
  if (now >= t.startsAt) return "LIVE";
  if (now < t.registrationOpensAt) return "OPENS_SOON";
  if (input.registrationManuallyClosed || now >= t.registrationClosesAt) return "CLOSED";
  if (input.capacity != null && (input.confirmedCount ?? 0) >= input.capacity) return "FULL";
  return "OPEN";
}

export const STATUS_LABEL: Record<RegistrationStatus, string> = {
  OPENS_SOON: "Registration opens soon",
  OPEN: "Registration open",
  CLOSED: "Registration closed",
  FULL: "Event full",
  LIVE: "Live now",
  ENDED: "Ended",
  CANCELLED: "Cancelled",
};
