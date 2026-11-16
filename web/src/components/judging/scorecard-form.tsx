"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { rateLimitMessage, sendJson, type ApiResult } from "@/components/auth/api";
import { FormAlert, FormNotice } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";

interface Criterion { id: string; name: string; description: string | null; maxScore: number; weight: number }
interface Existing { criterionId: string; score: number; feedback: string | null }

/** The judge's scorecard. The server validates every score against the criterion maximum and refuses incomplete finalization. */
export function ScorecardForm({ submissionId, criteria, scores, finalized }: { submissionId: string; criteria: Criterion[]; scores: Existing[]; finalized: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const byId = new Map(scores.map((s) => [s.criterionId, s]));

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const finalize = submitter?.value === "final";
    if (finalize && !window.confirm("Finalize this scorecard? You cannot change it afterwards unless an organizer reopens it.")) return;
    const f = new FormData(e.currentTarget);
    const rows = criteria
      .map((c) => ({ criterionId: c.id, raw: String(f.get(`score-${c.id}`) ?? "").trim(), feedback: String(f.get(`feedback-${c.id}`) ?? "").trim() }))
      .filter((r) => r.raw !== "")
      .map((r) => ({ criterionId: r.criterionId, score: Number(r.raw), feedback: r.feedback }));
    setPending(true);
    setMessage(null);
    const res = await sendJson(`/api/v1/submissions/${submissionId}/scorecard`, { scores: rows, finalize }, "PUT");
    setPending(false);
    setResult(res);
    if (res.ok) {
      const d = res.data as { percent: number | null; finalized: boolean };
      setMessage(d.finalized ? `Scorecard finalized. Your weighted score is ${d.percent} out of 100.` : d.percent !== null ? `Draft saved. Your weighted score would be ${d.percent} out of 100.` : "Draft saved. Some criteria are not scored yet.");
      router.refresh();
    }
  }

  const errors = result?.fieldErrors ?? {};
  const general = result && !result.ok ? (result.status === 429 ? rateLimitMessage(result.retryAfterSeconds) : (Object.values(errors)[0] ?? result.message)) : null;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6" aria-label="Scorecard">
      {general && <FormAlert>{general}</FormAlert>}
      {message && <FormNotice>{message}</FormNotice>}
      {finalized && <FormNotice>This scorecard is final. An organizer can reopen it if it needs a correction.</FormNotice>}
      {criteria.map((c) => {
        const mine = byId.get(c.id);
        return (
          <fieldset key={c.id} className="space-y-3 rounded-lg bg-surface p-4 shadow-card" disabled={finalized}>
            <legend className="px-1 font-semibold">{c.name} <span className="text-sm font-normal text-fg-muted">(weight {c.weight}, maximum {c.maxScore})</span></legend>
            {c.description && <p className="text-sm text-fg-muted">{c.description}</p>}
            <Field label={`Score for ${c.name} (0 to ${c.maxScore})`} required>
              {(p) => <Input {...p} name={`score-${c.id}`} type="number" inputMode="decimal" min={0} max={c.maxScore} step="0.01" defaultValue={mine?.score ?? ""} />}
            </Field>
            <Field label={`Feedback for ${c.name}`} hint="Shown to the team anonymously after results are published.">
              {(p) => <Textarea {...p} name={`feedback-${c.id}`} maxLength={2000} defaultValue={mine?.feedback ?? ""} className="min-h-20" />}
            </Field>
          </fieldset>
        );
      })}
      {!finalized && (
        <div className="flex flex-wrap gap-3">
          <Button type="submit" name="intent" value="draft" variant="secondary" disabled={pending} aria-disabled={pending}>Save draft</Button>
          <Button type="submit" name="intent" value="final" disabled={pending} aria-disabled={pending}>Finalize scorecard</Button>
        </div>
      )}
    </form>
  );
}
