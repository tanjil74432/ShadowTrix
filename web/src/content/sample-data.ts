/**
 * SAMPLE CONTENT: demonstration data for design review only.
 *
 * Nothing here is a real event, person or result. Every consumer must render it with
 * <SampleNotice> / <SampleBadge> / <PlaceholderBadge>. It is replaced by database-backed
 * content in Milestone 5 (events) and Milestone 6a (leadership).
 */
import { deriveEventStatus } from "@/lib/event-status";
import type { ProfileSummary } from "@/components/profile/profile-card";
import type { EventSummary, EventTimeline } from "@/types/event";
import type { EventCategoryKey } from "@/lib/event-categories";

/** Fixed reference date so sample statuses are stable and never depend on when the page renders. */
const SAMPLE_NOW = new Date("2026-11-15T12:00:00Z");

const utc = (iso: string) => new Date(`${iso}Z`);

function sample(
  slug: string,
  title: string,
  category: EventCategoryKey,
  summary: string,
  timeline: EventTimeline,
): EventSummary {
  return {
    slug,
    title,
    category,
    summary,
    timezone: "UTC",
    timeline,
    status: deriveEventStatus({ timeline, now: SAMPLE_NOW }),
    isSample: true,
  };
}

export const sampleUpcomingEvents: EventSummary[] = [
  sample(
    "sample-open-innovation-hackathon",
    "Open Innovation Hackathon",
    "HACKATHON",
    "A weekend build event for teams of two to four. Pick a problem statement, build a working prototype and present it to a panel of judges.",
    {
      registrationOpensAt: utc("2026-11-01T00:00:00"),
      registrationClosesAt: utc("2027-01-15T23:59:00"),
      startsAt: utc("2027-01-23T09:00:00"),
      endsAt: utc("2027-01-25T18:00:00"),
      submissionDeadline: utc("2027-01-25T12:00:00"),
      judgingStartsAt: utc("2027-01-25T14:00:00"),
      judgingEndsAt: utc("2027-01-27T18:00:00"),
      resultsAnnouncementAt: utc("2027-01-29T12:00:00"),
    },
  ),
  sample(
    "sample-applied-data-datathon",
    "Applied Data Datathon",
    "DATATHON",
    "Work with a provided dataset to find and communicate insights. Entries are judged on method, clarity and the strength of the evidence.",
    {
      registrationOpensAt: utc("2026-12-10T00:00:00"),
      registrationClosesAt: utc("2027-02-05T23:59:00"),
      startsAt: utc("2027-02-13T09:00:00"),
      endsAt: utc("2027-02-14T18:00:00"),
      submissionDeadline: utc("2027-02-14T12:00:00"),
      judgingStartsAt: utc("2027-02-15T09:00:00"),
      judgingEndsAt: utc("2027-02-18T18:00:00"),
      resultsAnnouncementAt: utc("2027-02-20T12:00:00"),
    },
  ),
  sample(
    "sample-intro-ml-workshop",
    "Introduction to Machine Learning Workshop",
    "WORKSHOP",
    "A hands-on, beginner-friendly session covering data preparation, a first model and how to evaluate it. No prior experience is required.",
    {
      registrationOpensAt: utc("2026-11-10T00:00:00"),
      registrationClosesAt: utc("2027-03-01T23:59:00"),
      startsAt: utc("2027-03-06T10:00:00"),
      endsAt: utc("2027-03-06T16:00:00"),
    },
  ),
];

export const samplePastEvents: EventSummary[] = [
  sample(
    "sample-algorithm-sprint",
    "Algorithm Sprint",
    "PROGRAMMING_CONTEST",
    "A timed contest of algorithmic problems with automatic scoring and a public leaderboard.",
    {
      registrationOpensAt: utc("2026-02-01T00:00:00"),
      registrationClosesAt: utc("2026-03-05T23:59:00"),
      startsAt: utc("2026-03-14T10:00:00"),
      endsAt: utc("2026-03-14T15:00:00"),
      resultsAnnouncementAt: utc("2026-03-16T12:00:00"),
    },
  ),
  sample(
    "sample-ai-challenge",
    "Applied AI Challenge",
    "AI_ML",
    "Participants trained and evaluated models on a shared benchmark and documented their approach.",
    {
      registrationOpensAt: utc("2026-05-01T00:00:00"),
      registrationClosesAt: utc("2026-06-10T23:59:00"),
      startsAt: utc("2026-06-20T09:00:00"),
      endsAt: utc("2026-06-21T18:00:00"),
      submissionDeadline: utc("2026-06-21T12:00:00"),
      judgingStartsAt: utc("2026-06-22T09:00:00"),
      judgingEndsAt: utc("2026-06-25T18:00:00"),
      resultsAnnouncementAt: utc("2026-06-27T12:00:00"),
    },
  ),
  sample(
    "sample-tech-summit",
    "Community Tech Summit",
    "SUMMIT",
    "A one-day program of talks and panels with time set aside for networking between sessions.",
    {
      registrationOpensAt: utc("2026-07-15T00:00:00"),
      registrationClosesAt: utc("2026-09-01T23:59:00"),
      startsAt: utc("2026-09-12T09:00:00"),
      endsAt: utc("2026-09-12T17:00:00"),
    },
  ),
];

/** Configurable example positions. Names are deliberately not invented. */
export const placeholderLeadership: ProfileSummary[] = [
  { slug: "placeholder-founder", name: "Name to be announced", designation: "Founder", term: "To be announced", isPlaceholder: true },
  { slug: "placeholder-president", name: "Name to be announced", designation: "President", term: "To be announced", isPlaceholder: true },
  { slug: "placeholder-cto", name: "Name to be announced", designation: "Chief Technology Officer (CTO)", term: "To be announced", isPlaceholder: true },
  { slug: "placeholder-events", name: "Name to be announced", designation: "Event Coordinator", term: "To be announced", isPlaceholder: true },
];

export const teamGroups = [
  { slug: "executive-board", name: "Leadership Board" },
  { slug: "core-team", name: "Core Team" },
  { slug: "technical-team", name: "Technical Team" },
  { slug: "event-management-team", name: "Event Management Team" },
  { slug: "marketing-and-creative", name: "Marketing & Creative Team" },
] as const;
