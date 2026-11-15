import * as Label from "@radix-ui/react-label";
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { AlertIcon } from "./icons";

const control =
  "w-full rounded-md border border-field-border bg-surface-raised px-3.5 text-base text-fg placeholder:text-fg-subtle " +
  "transition-colors duration-(--duration-fast) hover:border-fg-muted focus-visible:border-fg " +
  "disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, "h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-28 py-2.5", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, "h-11 appearance-none pr-9", className)} {...props} />;
}

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}

interface FieldProps {
  label: string;
  hint?: string;
  /** Error message. Rendered with an icon and text, and announced to assistive technology. */
  error?: string;
  required?: boolean;
  className?: string;
  /** Receives the id and ARIA attributes to spread onto the control. */
  children: (props: FieldControlProps) => ReactNode;
}

/** Label + control + hint/error wired together with correct ids and ARIA. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label.Root htmlFor={id} className="text-sm font-medium text-fg">
        {label}
        {required ? (
          <span className="ml-1 text-fg-muted" aria-hidden>
            *
          </span>
        ) : (
          <span className="ml-1.5 font-normal text-fg-subtle">(optional)</span>
        )}
      </Label.Root>
      {children({
        id,
        "aria-describedby": describedBy,
        ...(error ? { "aria-invalid": true as const } : {}),
        ...(required ? { "aria-required": true as const } : {}),
      })}
      {hint && (
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-sm text-danger">
          <AlertIcon className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
