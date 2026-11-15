import { describe, expect, it } from "vitest";
import { EventCategory } from "@/generated/prisma/enums";
import { EVENT_CATEGORIES } from "@/lib/event-categories";
import { deriveEventStatus } from "@/lib/event-status";
import { buildTimelineRows, formatDateRange, formatDateTime } from "@/lib/format";
import type { EventTimeline } from "@/types/event";

const d = (iso: string) => new Date(iso);
const timeline: EventTimeline = {
  registrationOpensAt: d("2027-01-01T00:00:00Z"),
  registrationClosesAt: d("2027-01-20T00:00:00Z"),
  startsAt: d("2027-01-24T09:00:00Z"),
  endsAt: d("2027-01-25T18:00:00Z"),
  submissionDeadline: d("2027-01-25T12:00:00Z"),
  judgingStartsAt: d("2027-01-25T18:00:00Z"),
  judgingEndsAt: d("2027-01-28T18:00:00Z"),
  resultsAnnouncementAt: d("2027-01-30T12:00:00Z"),
};

describe("deriveEventStatus", () => {
  const at = (iso: string, extra = {}) => deriveEventStatus({ timeline, now: d(iso), ...extra });

  it("walks through the lifecycle", () => {
    expect(at("2026-12-31T00:00:00Z")).toBe("OPENS_SOON");
    expect(at("2027-01-10T00:00:00Z")).toBe("OPEN");
    expect(at("2027-01-21T00:00:00Z")).toBe("CLOSED");
    expect(at("2027-01-24T10:00:00Z")).toBe("LIVE");
    expect(at("2027-01-26T00:00:00Z")).toBe("ENDED");
  });

  it("treats boundaries as exclusive of the earlier state", () => {
    expect(at("2027-01-01T00:00:00Z")).toBe("OPEN");
    expect(at("2027-01-20T00:00:00Z")).toBe("CLOSED");
    expect(at("2027-01-24T09:00:00Z")).toBe("LIVE");
    expect(at("2027-01-25T18:00:00Z")).toBe("ENDED");
  });

  it("reports FULL only while registration would otherwise be open", () => {
    expect(at("2027-01-10T00:00:00Z", { capacity: 50, confirmedCount: 50 })).toBe("FULL");
    expect(at("2027-01-10T00:00:00Z", { capacity: 50, confirmedCount: 49 })).toBe("OPEN");
    expect(at("2027-01-10T00:00:00Z", { capacity: null, confirmedCount: 999 })).toBe("OPEN");
    expect(at("2027-01-21T00:00:00Z", { capacity: 50, confirmedCount: 50 })).toBe("CLOSED");
  });

  it("honors a manual close and cancellation", () => {
    expect(at("2027-01-10T00:00:00Z", { registrationManuallyClosed: true })).toBe("CLOSED");
    expect(at("2027-01-10T00:00:00Z", { cancelled: true })).toBe("CANCELLED");
    expect(at("2027-02-10T00:00:00Z", { cancelled: true })).toBe("CANCELLED");
  });
});

describe("date formatting", () => {
  it("formats single-day, same-month, cross-month and cross-year ranges", () => {
    expect(formatDateRange(d("2027-01-24T09:00:00Z"), d("2027-01-24T18:00:00Z"), "UTC")).toBe("Jan 24, 2027");
    expect(formatDateRange(d("2027-01-24T09:00:00Z"), d("2027-01-25T18:00:00Z"), "UTC")).toBe("Jan 24 – 25, 2027");
    expect(formatDateRange(d("2027-01-30T09:00:00Z"), d("2027-02-02T18:00:00Z"), "UTC")).toBe("Jan 30 – Feb 2, 2027");
    expect(formatDateRange(d("2026-12-30T09:00:00Z"), d("2027-01-02T18:00:00Z"), "UTC")).toBe(
      "Dec 30, 2026 – Jan 2, 2027",
    );
  });

  it("respects the event time zone for day boundaries", () => {
    // 23:30 UTC on Jan 24 is already Jan 25 in Asia/Dhaka (UTC+6)
    expect(formatDateRange(d("2027-01-24T23:30:00Z"), d("2027-01-25T23:30:00Z"), "Asia/Dhaka")).toBe("Jan 25 – 26, 2027");
  });

  it("always includes an explicit time zone", () => {
    expect(formatDateTime(d("2027-01-24T09:00:00Z"), "UTC")).toMatch(/UTC$/);
  });
});

describe("buildTimelineRows", () => {
  it("returns the five phases in order with distinct labels", () => {
    const rows = buildTimelineRows(timeline, "UTC");
    expect(rows.map((r) => r.key)).toEqual(["registration", "event", "submission", "judging", "results"]);
    expect(new Set(rows.map((r) => r.label)).size).toBe(5);
    expect(rows.every((r) => r.scheduled)).toBe(true);
  });

  it("marks unscheduled optional phases as 'To be announced' instead of guessing", () => {
    const rows = buildTimelineRows(
      { ...timeline, submissionDeadline: null, judgingStartsAt: null, judgingEndsAt: null, resultsAnnouncementAt: null },
      "UTC",
    );
    expect(rows.filter((r) => !r.scheduled).map((r) => r.value)).toEqual([
      "To be announced",
      "To be announced",
      "To be announced",
    ]);
  });
});

describe("event categories", () => {
  it("stay in sync with the database enum", () => {
    expect(Object.keys(EVENT_CATEGORIES).sort()).toEqual(Object.values(EventCategory).sort());
  });
});
