"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ControlGroup, RangeControl } from "@/components/admin/leadership-controls";
import { DevicePreview } from "@/components/admin/leadership-template-editor";
import type { CardPerson } from "@/components/leadership/leadership-card";
import { Button } from "@/components/ui/button";
import type { LeadershipTemplate, MemberStyle } from "@/lib/leadership/template";

/**
 * One member's card: the portrait position and the decorative text, previewed live in the shared Universal Matrix template.
 * Save keeps the member as they are; Save as draft hides them; Publish makes them public (verified and published) after a confirmation.
 */
export function MemberCardEditor({ memberId, person, template, initial, published, hasPhoto }: { memberId: string; person: CardPerson; template: LeadershipTemplate; initial: MemberStyle; published: boolean; hasPhoto: boolean }) {
  const router = useRouter();
  const [s, setS] = useState<MemberStyle>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const set = <K extends keyof MemberStyle>(k: K, v: MemberStyle[K]) => setS((x) => ({ ...x, [k]: v }));

  async function send(url: string, method: "PUT" | "PATCH", body: unknown) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" }).catch(() => null);
    if (res?.ok) return true;
    const data = (await res?.json().catch(() => null)) as { error?: { message?: string; issues?: { path: (string | number)[]; message: string }[] } } | null;
    setError(data?.error?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") || data?.error?.message || "That could not be saved.");
    return false;
  }

  async function run(label: string, member?: { visibility: "DRAFT" | "PUBLISHED"; isPlaceholder?: boolean }) {
    setBusy(true); setError(""); setStatus("");
    const ok = (await send(`/api/v1/admin/members/${memberId}/card`, "PUT", s)) && (!member || (await send(`/api/v1/admin/members/${memberId}`, "PATCH", member)));
    setBusy(false);
    if (ok) { setStatus(label); router.refresh(); }
  }

  function publish() {
    if (!hasPhoto && !window.confirm("This member has no portrait yet. Publish anyway?")) return;
    if (!window.confirm(`Publish ${person.name}? They will appear on the homepage and the Leadership Board. Confirm that their details were verified with them.`)) return;
    void run("Member published. They now appear on the homepage and the Leadership Board.", { visibility: "PUBLISHED", isPlaceholder: false });
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
      <div className="min-w-0 space-y-5">
        <ControlGroup title="Portrait position">
          <RangeControl label="Zoom" value={s.zoom} min={0.5} max={3} step={0.01} onChange={(v) => set("zoom", v)} />
          <RangeControl label="Left / right" value={s.x} min={-50} max={50} step={1} onChange={(v) => set("x", v)} unit="%" />
          <RangeControl label="Up / down" value={s.y} min={-50} max={50} step={1} onChange={(v) => set("y", v)} unit="%" />
          <button type="button" onClick={() => setS((x) => ({ ...x, zoom: 1, x: 0, y: 0 }))} className="text-sm underline underline-offset-4">Reset portrait positioning</button>
        </ControlGroup>
        <ControlGroup title="Decorative text for this member">
          <div className="space-y-1">
            <label htmlFor="deco-text" className="block text-sm">Text behind the portrait</label>
            <input id="deco-text" value={s.text} maxLength={40} placeholder={person.name} onChange={(e) => set("text", e.target.value)} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm" />
            <p className="text-xs text-fg-muted">Empty uses the member&apos;s name. Decoration only: the verified name and designation never change.</p>
          </div>
          <RangeControl label="Text size" value={s.textScale} min={0.5} max={1.6} step={0.01} onChange={(v) => set("textScale", v)} />
          <RangeControl label="Text left / right" value={s.textX} min={-40} max={40} step={1} onChange={(v) => set("textX", v)} unit="%" />
          <RangeControl label="Text up / down" value={s.textY} min={-40} max={40} step={1} onChange={(v) => set("textY", v)} unit="%" />
          <button type="button" onClick={() => setS((x) => ({ ...x, text: "", textX: 0, textY: 0, textScale: 1 }))} className="text-sm underline underline-offset-4">Reset decorative text</button>
        </ControlGroup>
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => void run("Design saved.")} disabled={busy}>Save member design</Button>
          <Button type="button" variant="secondary" onClick={() => void run("Saved as a draft. The member is not shown publicly.", { visibility: "DRAFT" })} disabled={busy}>Save as draft</Button>
          <Button type="button" onClick={publish} disabled={busy}>{published ? "Update and keep published" : "Publish member"}</Button>
        </div>
        <p role="alert" className="min-h-5 text-sm text-danger">{error}</p>
        <p role="status" className="min-h-5 text-sm text-fg-muted">{status}</p>
      </div>
      <div className="min-w-0 lg:sticky lg:top-24"><DevicePreview person={person} template={template} style={s} /></div>
    </div>
  );
}
