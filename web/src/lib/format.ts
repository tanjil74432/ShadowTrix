import type { EventTimeline } from "@/types/event";

const LOCALE = "en-US";

function fmt(date: Date, timeZone: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(LOCALE, { timeZone, ...opts }).format(date);
}

function ymd(date: Date, timeZone: string) {
  return fmt(date, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
}

/** "Jan 10, 2027" */
export function formatDate(date: Date, timeZone: string) {
  return fmt(date, timeZone, { month: "short", day: "numeric", year: "numeric" });
}

/** "Jan 10, 2027, 18:00 UTC" (24-hour, with explicit zone so nothing is ambiguous). */
export function formatDateTime(date: Date, timeZone: string) {
  return fmt(date, timeZone, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  });
}

/** "Jan 24, 2027", "Jan 24 – 25, 2027", "Jan 30 – Feb 2, 2027", or "Dec 30, 2026 – Jan 2, 2027". */
export function formatDateRange(start: Date, end: Date, timeZone: string) {
  if (ymd(start, timeZone) === ymd(end, timeZone)) return formatDate(start, timeZone);
  const sy = fmt(start, timeZone, { year: "numeric" });
  const ey = fmt(end, timeZone, { year: "numeric" });
  if (sy !== ey) return `${formatDate(start, timeZone)} – ${formatDate(end, timeZone)}`;
  const sm = fmt(start, timeZone, { month: "short" });
  const em = fmt(end, timeZone, { month: "short" });
  const sd = fmt(start, timeZone, { day: "numeric" });
  const ed = fmt(end, timeZone, { day: "numeric" });
  return sm === em ? `${sm} ${sd} – ${ed}, ${sy}` : `${sm} ${sd} – ${em} ${ed}, ${sy}`;
}

export interface TimelineRow {
  key: "registration" | "event" | "submission" | "judging" | "results";
  label: string;
  /** Human-readable value, or "To be announced" when the phase is not scheduled. */
  value: string;
  scheduled: boolean;
  /** ISO start for <time dateTime>. */
  iso?: string;
}

/** The five distinct phases of an event, in chronological order. */
export function buildTimelineRows(t: EventTimeline, timeZone: string): TimelineRow[] {
  const tba = "To be announced";
  const range = (a?: Date | null, b?: Date | null) =>
    a && b ? `${formatDateTime(a, timeZone)} to ${formatDateTime(b, timeZone)}` : a ? formatDateTime(a, timeZone) : tba;
  return [
    {
      key: "registration",
      label: "Registration",
      value: range(t.registrationOpensAt, t.registrationClosesAt),
      scheduled: true,
      iso: t.registrationOpensAt.toISOString(),
    },
    { key: "event", label: "Event", value: range(t.startsAt, t.endsAt), scheduled: true, iso: t.startsAt.toISOString() },
    {
      key: "submission",
      label: "Submission deadline",
      value: t.submissionDeadline ? formatDateTime(t.submissionDeadline, timeZone) : tba,
      scheduled: !!t.submissionDeadline,
      iso: t.submissionDeadline?.toISOString(),
    },
    {
      key: "judging",
      label: "Judging",
      value: t.judgingStartsAt && t.judgingEndsAt ? range(t.judgingStartsAt, t.judgingEndsAt) : tba,
      scheduled: !!(t.judgingStartsAt && t.judgingEndsAt),
      iso: t.judgingStartsAt?.toISOString(),
    },
    {
      key: "results",
      label: "Results announced",
      value: t.resultsAnnouncementAt ? formatDateTime(t.resultsAnnouncementAt, timeZone) : tba,
      scheduled: !!t.resultsAnnouncementAt,
      iso: t.resultsAnnouncementAt?.toISOString(),
    },
  ];
}
