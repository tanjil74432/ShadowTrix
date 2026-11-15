import { cn } from "@/lib/cn";

/** Placeholder block shown while content loads. Decorative; pair with a role="status" region for announcements. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-md", className)} />;
}

export function Spinner({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2 text-sm text-fg-muted", className)}>
      <svg viewBox="0 0 24 24" className="size-4 motion-safe:animate-spin" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label}
    </span>
  );
}

/** Loading layout that matches EventCard so content does not jump when it arrives. */
export function EventCardSkeleton() {
  return (
    <div role="status" aria-label="Loading event" className="overflow-hidden rounded-lg bg-surface shadow-card">
      <Skeleton className="aspect-video rounded-none" />
      <div className="space-y-3 p-5">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="mt-4 h-4 w-1/2" />
      </div>
    </div>
  );
}
