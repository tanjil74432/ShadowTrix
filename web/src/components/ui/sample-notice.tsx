import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Banner placed above any block of demonstration content so it is never mistaken for real data. */
export function SampleNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="note"
      className={cn(
        "rounded-md border border-dashed border-border-strong bg-surface px-4 py-3 text-sm text-fg-muted",
        className,
      )}
    >
      <strong className="font-semibold text-fg">Sample content. </strong>
      {children}
    </p>
  );
}
