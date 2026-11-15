import type { HTMLAttributes } from "react";
import { EVENT_CATEGORIES, type EventCategoryKey } from "@/lib/event-categories";
import { cn } from "@/lib/cn";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border-strong bg-bg/70 px-2.5 py-0.5 text-xs font-medium text-fg-muted",
        className,
      )}
      {...props}
    />
  );
}

export function CategoryBadge({ category, className }: { category: EventCategoryKey; className?: string }) {
  return <Badge className={cn("text-silver", className)}>{EVENT_CATEGORIES[category].label}</Badge>;
}

/** Marks demonstration content. Visible text, never color alone. */
export function SampleBadge({ className }: { className?: string }) {
  return <Badge className={cn("border-dashed text-fg", className)}>Sample</Badge>;
}

export function PlaceholderBadge({ className }: { className?: string }) {
  return <Badge className={cn("border-dashed text-fg", className)}>Placeholder profile</Badge>;
}
