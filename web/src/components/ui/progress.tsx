import { cn } from "@/lib/cn";

/** Determinate progress bar. The numbers are always in the text next to it; the bar is a visual aid with proper ARIA. */
export function Progress({ value, max, label, className }: { value: number; max: number; label: string; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-raised shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)]", className)}
    >
      <div className="h-full origin-left animate-grow-x rounded-full bg-gradient-to-r from-accent-deep to-accent-soft shadow-glow-soft" style={{ width: `${pct}%` }} />
    </div>
  );
}
