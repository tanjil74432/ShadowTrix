import type { HTMLAttributes } from "react";
import { EVENT_CATEGORIES, type EventCategoryKey } from "@/lib/event-categories";
import { cn } from "@/lib/cn";

const TONES = {
  neutral: "border-border-strong bg-bg/85 text-fg-muted",
  accent: "border-accent/45 bg-accent-wash text-accent-soft",
  success: "border-success/40 bg-[#0f2418] text-success",
  warning: "border-warning/40 bg-[#2a2410] text-warning",
  danger: "border-danger/45 bg-[#2a1212] text-danger",
} as const;

export function Badge({ className, tone = "neutral", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "accent" | "success" | "warning" | "danger" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

export function CategoryBadge({ category, className }: { category: EventCategoryKey; className?: string }) {
  return <Badge tone="accent" className={className}>{EVENT_CATEGORIES[category].label}</Badge>;
}

/** Marks demonstration content. Visible text, never color alone. */
export function SampleBadge({ className }: { className?: string }) {
  return <Badge className={cn("border-dashed text-fg", className)}>Sample</Badge>;
}

export function PlaceholderBadge({ className }: { className?: string }) {
  return <Badge className={cn("border-dashed text-fg", className)}>Placeholder profile</Badge>;
}
