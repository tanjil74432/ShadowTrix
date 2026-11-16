import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg" | "icon" | "wrap";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium select-none " +
  "transition-colors duration-(--duration-fast) disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const variants: Record<Variant, string> = {
  // White-on-black is the single emphasized action on any screen.
  primary: "bg-accent text-on-accent shadow-[0_1px_0_rgb(255_255_255/0.22)_inset] transition-[background-color,box-shadow,transform] hover:bg-accent-soft hover:shadow-glow active:translate-y-px active:bg-accent-deep motion-reduce:active:translate-y-0",
  secondary: "border border-accent/30 text-fg hover:border-accent/70 hover:bg-accent-wash hover:text-accent-soft",
  ghost: "text-fg-muted hover:text-accent-soft hover:bg-surface-raised",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm whitespace-nowrap",
  md: "h-11 px-5 text-base whitespace-nowrap", // 44px: comfortable touch target
  lg: "h-12 px-6 text-base whitespace-nowrap",
  icon: "size-11 whitespace-nowrap", // square icon-only button, 44px touch target; always give it an aria-label
  wrap: "min-h-11 max-w-full px-5 py-2 text-base text-center", // for long labels: the text wraps on narrow screens and the button grows in height (no horizontal overflow)
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
