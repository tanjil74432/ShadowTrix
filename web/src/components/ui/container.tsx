import type { ElementType, HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface ContainerProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
}

/** Page-width wrapper: 16px gutters on phones, wider on larger screens, capped at 80rem. */
export function Container({ as: Comp = "div", className, ...props }: ContainerProps) {
  return <Comp className={cn("mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8", className)} {...props} />;
}
