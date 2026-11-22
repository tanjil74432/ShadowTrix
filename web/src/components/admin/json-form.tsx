"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { rateLimitMessage, sendJson, type ApiResult } from "@/components/auth/api";
import { FormAlert, FormNotice } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

export interface FieldSpec {
  name: string;
  label: string;
  type?: "text" | "textarea" | "select" | "checkbox" | "number" | "date" | "url" | "email" | "list" | "combo";
  options?: { value: string; label: string }[];
  /** For a "combo" field: names suggested while typing (any other value can still be typed). */
  suggestions?: string[];
  /** For a "combo" field: one-click choices shown under the field. */
  quick?: string[];
  hint?: string;
  required?: boolean;
  defaultValue?: string | boolean | number | null;
}

interface Props {
  url: string;
  method?: "POST" | "PATCH" | "PUT";
  fields: FieldSpec[];
  submitLabel: string;
  successMessage?: string;
  label: string;
  reset?: boolean;
  /** Extra constant properties sent with the form values. */
  extra?: Record<string, unknown>;
}

/**
 * A small form that sends its fields as JSON to an administration endpoint and shows the server's messages on the fields.
 * Every rule is enforced by the server; this component only collects values.
 */
export function JsonForm({ url, method = "POST", fields, submitLabel, successMessage = "Saved.", label, reset = false, extra }: Props) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { ...extra };
    for (const spec of fields) {
      if (spec.type === "checkbox") body[spec.name] = f.get(spec.name) === "on";
      else if (spec.type === "list") body[spec.name] = String(f.get(spec.name) ?? "").split(",").map((v) => v.trim()).filter(Boolean);
      else body[spec.name] = f.get(spec.name) ?? "";
    }
    setPending(true);
    const res = await sendJson(url, body, method);
    setPending(false);
    setResult(res);
    if (res.ok) {
      if (reset) ref.current?.reset();
      router.refresh();
    }
  }

  const errors = result?.fieldErrors ?? {};
  const general = result && !result.ok && Object.keys(errors).length === 0 ? (result.status === 429 ? rateLimitMessage(result.retryAfterSeconds) : result.message) : null;
  return (
    <form ref={ref} onSubmit={onSubmit} noValidate className="space-y-4" aria-label={label}>
      {general && <FormAlert>{general}</FormAlert>}
      {Object.keys(errors).length > 0 && <FormAlert>Fix the marked fields and try again.</FormAlert>}
      {result?.ok && <FormNotice>{successMessage}</FormNotice>}
      {fields.map((spec) => {
        const err = errors[spec.name];
        if (spec.type === "checkbox") {
          return (
            <div key={spec.name} className="flex items-start gap-2">
              <input id={`${label}-${spec.name}`} name={spec.name} type="checkbox" defaultChecked={!!spec.defaultValue} className="mt-1 size-4" />
              <label htmlFor={`${label}-${spec.name}`} className="text-sm">
                {spec.label}
                {spec.hint && <span className="block text-fg-muted">{spec.hint}</span>}
              </label>
            </div>
          );
        }
        return (
          <Field key={spec.name} label={spec.label} required={spec.required} error={err} hint={spec.hint}>
            {(p) =>
              spec.type === "textarea" ? (
                <Textarea {...p} name={spec.name} defaultValue={(spec.defaultValue as string) ?? ""} className="min-h-24" />
              ) : spec.type === "select" ? (
                <Select {...p} name={spec.name} defaultValue={(spec.defaultValue as string) ?? ""}>
                  {spec.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : spec.type === "combo" ? (
                <>
                  <Input {...p} name={spec.name} type="text" list={`${p.id}-suggestions`} autoComplete="off" defaultValue={spec.defaultValue == null ? "" : String(spec.defaultValue)} />
                  <datalist id={`${p.id}-suggestions`}>{spec.suggestions?.map((s) => <option key={s} value={s} />)}</datalist>
                  {!!spec.quick?.length && (
                    <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={`Quick choices for ${spec.label}`}>
                      {spec.quick.map((q) => (
                        <button key={q} type="button" onClick={() => { const el = ref.current?.elements.namedItem(spec.name) as HTMLInputElement | null; if (el) { el.value = q; el.focus(); } }} className="rounded-md border border-border px-3 py-1 text-sm hover:border-accent/70">
                          Use {q}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <Input {...p} name={spec.name} type={spec.type === "list" ? "text" : (spec.type ?? "text")} defaultValue={spec.defaultValue == null ? "" : String(spec.defaultValue)} />
              )
            }
          </Field>
        );
      })}
      <Button type="submit" variant="secondary" size="wrap" disabled={pending} aria-disabled={pending}>
        {pending ? "Saving" : submitLabel}
      </Button>
    </form>
  );
}
