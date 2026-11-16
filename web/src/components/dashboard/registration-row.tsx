import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EVENT_CATEGORIES, type EventCategoryKey } from "@/lib/event-categories";
import { formatDateRange } from "@/lib/format";

interface Props {
  registration: {
    status: "PENDING" | "CONFIRMED" | "WAITLISTED" | "CANCELLED";
    event: { slug: string; title: string; category: string; status: string; startsAt: Date; endsAt: Date; timezone: string; resultsPublishedAt?: Date | null; submissionDeadline?: Date | null };
  };
  now: Date;
}

const LABEL = { PENDING: "Pending", CONFIRMED: "Confirmed", WAITLISTED: "On the waiting list", CANCELLED: "Cancelled" } as const;

export function RegistrationRow({ registration: r, now }: Props) {
  const e = r.event;
  const phase = e.status === "CANCELLED" ? "Event cancelled" : e.endsAt <= now ? "Ended" : e.startsAt <= now ? "Live now" : "Upcoming";
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-4 shadow-card">
      <div className="min-w-0">
        <p className="font-medium text-balance">
          <Link href={`/events/${e.slug}`} className="underline underline-offset-4">{e.title}</Link>
        </p>
        <p className="mt-1 text-sm text-fg-muted">
          {EVENT_CATEGORIES[e.category as EventCategoryKey]?.label ?? e.category} · <time dateTime={e.startsAt.toISOString()}>{formatDateRange(e.startsAt, e.endsAt, e.timezone)}</time>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={r.status === "CONFIRMED" ? "success" : r.status === "WAITLISTED" ? "warning" : r.status === "CANCELLED" ? "danger" : "neutral"}>{LABEL[r.status]}</Badge>
        <Badge tone={phase === "Live now" ? "accent" : "neutral"}>{phase}</Badge>
        {r.status === "CONFIRMED" && e.status === "PUBLISHED" && (
          <Link href={`/events/${e.slug}/submission`} className="text-sm font-medium underline underline-offset-4">
            Project
          </Link>
        )}
        {e.resultsPublishedAt && (
          <Link href={`/events/${e.slug}/results`} className="text-sm font-medium underline underline-offset-4">
            Results
          </Link>
        )}
      </div>
    </li>
  );
}
