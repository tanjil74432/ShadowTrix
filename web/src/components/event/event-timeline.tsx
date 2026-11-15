import { buildTimelineRows } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { EventTimeline as Timeline } from "@/types/event";

interface EventTimelineProps {
  timeline: Timeline;
  timezone: string;
  className?: string;
}

/**
 * The five phases of an event, each with its own label: registration, event, submission
 * deadline, judging, results. Unscheduled phases read "To be announced" rather than being hidden or guessed.
 */
export function EventTimeline({ timeline, timezone, className }: EventTimelineProps) {
  const rows = buildTimelineRows(timeline, timezone);
  return (
    <ol className={cn("relative space-y-6 border-l border-border-strong pl-6", className)}>
      {rows.map((row) => (
        <li key={row.key} className="relative">
          <span
            aria-hidden
            className={cn(
              "absolute top-1.5 -left-[1.9rem] size-2.5 rounded-full border border-fg-muted",
              row.scheduled ? "bg-fg" : "bg-bg",
            )}
          />
          <p className="font-medium">{row.label}</p>
          <p className={cn("mt-0.5 text-sm", row.scheduled ? "text-fg-muted" : "text-fg-subtle")}>
            {row.scheduled && row.iso ? <time dateTime={row.iso}>{row.value}</time> : row.value}
          </p>
        </li>
      ))}
    </ol>
  );
}
