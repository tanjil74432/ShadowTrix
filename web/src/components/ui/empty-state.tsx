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
        "flex flex-col items-center rounded-lg border border-dashed border-accent/35 bg-[radial-gradient(ellipse_60%_80%_at_50%_0%,rgb(217_95_27/0.14),transparent_75%)] px-6 py-12 text-center",
        className,
      )}
    >
      <div className="mb-4 grid size-14 place-items-center rounded-full bg-accent-wash text-3xl text-accent-soft ring-1 ring-accent/30">{icon ?? <InboxIcon />}</div>
      <Heading className="text-h3 font-semibold">{title}</Heading>
      {description && <p className="mt-2 max-w-md text-fg-muted text-pretty">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
