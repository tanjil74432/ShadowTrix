import { STATUS_LABEL } from "@/lib/event-status";
import { cn } from "@/lib/cn";
import type { RegistrationStatus } from "@/types/event";

/**
 * Status is conveyed by text AND a distinct shape, never by color alone.
 * OPEN filled dot · OPENS_SOON hollow dot · CLOSED bar · FULL half dot · LIVE dot with ring · ENDED square · CANCELLED cross.
 */
function Glyph({ status }: { status: RegistrationStatus }) {
  const common = { width: 10, height: 10, viewBox: "0 0 10 10", "aria-hidden": true, focusable: false as const };
  switch (status) {
    case "OPEN":
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="4" fill="currentColor" />
        </svg>
      );
    case "OPENS_SOON":
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="3.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "CLOSED":
      return (
        <svg {...common}>
          <rect x="0.5" y="4" width="9" height="2" fill="currentColor" />
        </svg>
      );
    case "FULL":
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="3.75" fill="none" stroke="currentColor" strokeWidth="1.25" />
          <path d="M5 1.25a3.75 3.75 0 010 7.5z" fill="currentColor" />
        </svg>
      );
    case "LIVE":
      return <span aria-hidden className="block size-2.5 rounded-full bg-current animate-pulse-ring" />;
    case "ENDED":
      return (
        <svg {...common}>
          <rect x="1.5" y="1.5" width="7" height="7" fill="currentColor" />
        </svg>
      );
    case "CANCELLED":
      return (
        <svg {...common}>
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

export function StatusBadge({ status, className }: { status: RegistrationStatus; className?: string }) {
  const emphasized = status === "OPEN" || status === "LIVE";
  const upcoming = status === "OPENS_SOON";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        emphasized
          ? "bg-accent text-on-accent shadow-glow-soft"
          : upcoming
            ? "border border-accent/50 bg-accent-wash text-accent-soft"
            : status === "FULL"
              ? "border border-warning/40 bg-[#2a2410] text-warning"
              : status === "CANCELLED"
                ? "border border-danger/45 bg-[#2a1212] text-danger"
                : "border border-border-strong bg-bg/85 text-fg",
        className,
      )}
    >
      <Glyph status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}
