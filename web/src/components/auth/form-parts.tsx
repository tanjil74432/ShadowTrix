"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/field";
import type { FieldControlProps } from "@/components/ui/field";
import { cn } from "@/lib/cn";

/** Form-level error. role="alert" makes screen readers announce it when it appears. */
export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/60 bg-surface-raised px-4 py-3 text-sm text-danger">
      <AlertIcon className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

/** Neutral confirmation (role="status": announced politely). */
export function FormNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="status" className={cn("rounded-md border border-accent/40 border-l-4 border-l-accent bg-accent-wash px-4 py-3 text-sm text-silver", className)}>
      {children}
    </div>
  );
}

/** Success panel that takes focus so keyboard and screen-reader users land on the result. */
export function ResultPanel({ title, children }: { title: string; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div role="status" className="space-y-4">
      <h2 ref={ref} tabIndex={-1} className="text-h3 font-semibold outline-none">
        {title}
      </h2>
      <div className="space-y-3 text-fg-muted text-pretty">{children}</div>
    </div>
  );
}

/** Password field with a show/hide toggle (aria-pressed) so people can check what they typed. */
export function PasswordInput(props: FieldControlProps & Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className="pr-20" />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-1 my-1 rounded-md px-3 text-sm font-medium text-fg-muted hover:text-fg"
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}
