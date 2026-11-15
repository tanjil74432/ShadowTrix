import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { InboxIcon } from "./icons";

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  headingLevel?: "h2" | "h3";
  className?: string;
}

/** Honest "nothing here yet" panel. Use instead of fabricating content. */
export function EmptyState({ title, description, action, icon, headingLevel: Heading = "h3", className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-lg border border-dashed border-border-strong px-6 py-12 text-center",
        className,
      )}
    >
      <div className="mb-4 text-3xl text-fg-muted">{icon ?? <InboxIcon />}</div>
      <Heading className="text-h3 font-semibold">{title}</Heading>
      {description && <p className="mt-2 max-w-md text-fg-muted text-pretty">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
