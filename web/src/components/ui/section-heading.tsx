import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface SectionHeadingProps {
  id?: string;
  title: string;
  description?: ReactNode;
  /** Short plain-case label above the title (no tracked uppercase). */
  eyebrow?: string;
  align?: "left" | "center";
  as?: "h1" | "h2";
  /** Right-aligned slot, e.g. a "View all" link. */
  action?: ReactNode;
  className?: string;
}

export function SectionHeading({
  id,
  title,
  description,
  eyebrow,
  align = "left",
  as: Heading = "h2",
  action,
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        align === "center" && "items-center text-center sm:flex-col sm:items-center",
        className,
      )}
    >
      <div className={cn("max-w-2xl", align === "center" && "mx-auto")}>
        {eyebrow && <p className="mb-3 text-sm font-medium text-fg-muted">{eyebrow}</p>}
        <Heading id={id} className={cn("text-balance font-semibold", Heading === "h1" ? "text-h1" : "text-h2")}>
          {title}
        </Heading>
        {description && <p className="mt-4 text-body-lg text-fg-muted text-pretty">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
