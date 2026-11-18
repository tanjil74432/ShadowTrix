"use client";

import Link from "next/link";
import { useState } from "react";
import { DownloadTemplate } from "@/components/admin/download-template";
import { PortraitDragLayer, type DragValue } from "@/components/admin/portrait-drag";
import { TemplateControls } from "@/components/admin/leadership-controls";
import { LeadershipCard, type CardPerson } from "@/components/leadership/leadership-card";
import { Button } from "@/components/ui/button";
import { DEFAULT_LEADERSHIP_TEMPLATE, type LeadershipTemplate, type MemberStyle } from "@/lib/leadership/template";

export const DEVICES = [
  { id: "desktop", label: "Desktop", width: 360 },
  { id: "tablet", label: "Tablet", width: 300 },
  { id: "mobile", label: "Mobile", width: 220 },
] as const;
export type DeviceId = (typeof DEVICES)[number]["id"];


/** A device switcher plus the card, exactly as the public pages render it (the same component, the same template). */
export function DevicePreview({ person, template, style, drag }: { person: CardPerson; template: LeadershipTemplate; style?: Partial<MemberStyle> | null; drag?: { value: DragValue; onChange: (v: DragValue) => void } }) {
  const [device, setDevice] = useState<DeviceId>("desktop");
  const width = DEVICES.find((d) => d.id === device)!.width;
  return (
    <div className="space-y-3" data-testid="leadership-preview">
      <div role="group" aria-label="Preview size" className="flex gap-2">
        {DEVICES.map((d) => (
          <button key={d.id} type="button" aria-pressed={device === d.id} onClick={() => setDevice(d.id)} className={`rounded-md border px-3 py-1.5 text-sm ${device === d.id ? "border-[var(--color-accent)] bg-surface-2 font-semibold" : "border-border"}`}>
            {d.label}
          </button>
        ))}
      </div>
      <div role="region" aria-label="Card preview" tabIndex={0} className="overflow-x-auto rounded-lg border border-dashed border-border p-4">
        <div style={{ width: `min(${width}px, 100%)` }} className="relative mx-auto" data-testid="leadership-preview-frame" data-device={device}>
          <LeadershipCard person={person} template={template} style={style} eager />
          {drag && person.photoSrc && <PortraitDragLayer value={drag.value} onChange={drag.onChange} />}
        </div>
      </div>
      <p className="text-center text-xs text-fg-muted">{DEVICES.find((d) => d.id === device)!.label} width: {width}px. This is the same card the public pages show.</p>
    </div>
  );
}

export interface PreviewOption { id: string; name: string }

export function LeadershipTemplateEditor({ initial, person, members, selectedMemberId, memberStyle }: { initial: LeadershipTemplate; person: CardPerson; members: PreviewOption[]; selectedMemberId: string; memberStyle?: MemberStyle | null }) {
  const [t, setT] = useState<LeadershipTemplate>(initial);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const update = (next: LeadershipTemplate) => setT(next);
  const preview: LeadershipTemplate = t;

  async function call(method: "PUT" | "DELETE", body?: unknown) {
    setBusy(true); setError(""); setStatus("");
    const res = await fetch("/api/v1/admin/leadership/template", { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" }).catch(() => null);
    setBusy(false);
    const data = (await res?.json().catch(() => null)) as { template?: LeadershipTemplate; error?: { message?: string; issues?: { path: (string | number)[]; message: string }[] } } | null;
    if (!res?.ok || !data?.template) {
      setError(data?.error?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") || data?.error?.message || "The template could not be saved.");
      return null;
    }
    return data.template;
  }

  async function save() {
    const saved = await call("PUT", t);
    if (saved) { update(saved); setStatus("Template saved. It now applies to every board member on the homepage and the Leadership Board."); }
  }
  async function reset() {
    if (!window.confirm("Reset the template to its default design? Every board member's card changes with it.")) return;
    const def = await call("DELETE");
    if (def) { update(def); setStatus("Template reset to the default design."); }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
      <div className="order-2 min-w-0 space-y-5 lg:order-1">
        <TemplateControls t={t} set={update} />
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => void save()} disabled={busy}>Save template</Button>
          <Button type="button" variant="secondary" onClick={() => void reset()} disabled={busy}>Reset to default</Button>
          <Button type="button" variant="ghost" onClick={() => { update(initial); setStatus("Unsaved changes discarded."); }} disabled={busy}>Discard changes</Button>
        </div>
        <p role="alert" className="min-h-5 text-sm text-danger">{error}</p>
        <p role="status" className="min-h-5 text-sm text-fg-muted">{status}</p>
        {JSON.stringify(t) === JSON.stringify(DEFAULT_LEADERSHIP_TEMPLATE) && <p className="text-xs text-fg-muted">This is the default design.</p>}
      </div>
      <div className="order-1 min-w-0 space-y-4 lg:order-2 lg:sticky lg:top-24">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="preview-member" className="block text-sm">Preview with</label>
            <select id="preview-member" name="member" defaultValue={selectedMemberId} className="h-10 rounded-md border border-border bg-surface px-3 text-sm">
              <option value="">Sample member</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <Button type="submit" variant="secondary" size="sm">Show</Button>
          <Link href="/about/team" className="text-sm underline underline-offset-4">Open the public Leadership Board</Link>
        </form>
        <DevicePreview person={person} template={preview} style={memberStyle} drag={{ value: { x: t.portrait.x, y: t.portrait.y }, onChange: (v) => update({ ...t, portrait: { ...t.portrait, x: v.x, y: v.y } }) }} />
        {person.photoSrc && <p className="text-xs text-fg-muted">Drag the portrait in the preview to set the default portrait position for every member (or use the position sliders). Each member can still be adjusted on their own page.</p>}
        <DownloadTemplate person={person} template={preview} style={memberStyle} />
      </div>
    </div>
  );
}
