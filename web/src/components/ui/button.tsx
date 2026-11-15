import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg" | "icon";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap select-none " +
  "transition-colors duration-(--duration-fast) disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const variants: Record<Variant, string> = {
  // White-on-black is the single emphasized action on any screen.
  primary: "bg-accent text-bg hover:bg-silver active:bg-fg-muted",
  secondary: "border border-border-strong text-fg hover:border-fg-muted hover:bg-surface-raised",
  ghost: "text-fg-muted hover:text-fg hover:bg-surface-raised",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-11 px-5 text-base", // 44px: comfortable touch target
  lg: "h-12 px-6 text-base",
  icon: "size-11", // square icon-only button, 44px touch target; always give it an aria-label
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Render as the child element (e.g. next/link) while keeping button styles. */
  asChild?: boolean;
}

export function Button({ variant = "primary", size = "md", asChild, className, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(base, variants[variant], sizes[size], className)}
      {...(asChild ? {} : { type: type ?? "button" })}
      {...props}
    />
  );
}
