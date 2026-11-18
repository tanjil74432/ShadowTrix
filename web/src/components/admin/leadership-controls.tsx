"use client";

import { useId, type ReactNode } from "react";
import {
  ACCENTS, BASES, FONTS, FONT_LABELS, TEXT_COLORS, WEIGHTS,
  type LeadershipTemplate,
} from "@/lib/leadership/template";

/** Small control kit shared by the template editor and the member card editor. Every control is a real labelled form element. */
export function RangeControl({ label, value, min, max, step, onChange, unit = "" }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; unit?: string }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex justify-between text-sm"><span>{label}</span><output htmlFor={id} className="tabular-nums text-fg-muted">{Number(value.toFixed(2))}{unit}</output></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
    </div>
  );
}

export function SelectControl<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm">{label}</label>
      <select id={id} value={String(value)} onChange={(e) => { const o = options.find((x) => String(x.value) === e.target.value); if (o) onChange(o.value); }} className="h-10 w-full max-w-full min-w-0 rounded-md border border-border bg-surface px-3 text-sm">
        {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function ToggleControl({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
      {label}
    </label>
  );
}

export function ColorControl({ label, value, palette, onChange }: { label: string; value: string; palette: readonly string[]; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <span id={`${id}-l`} className="block text-sm">{label}</span>
      <div role="group" aria-labelledby={`${id}-l`} className="flex flex-wrap items-center gap-2">
        {palette.map((c) => (
          <button key={c} type="button" aria-label={`${label} ${c}`} aria-pressed={value === c} onClick={() => onChange(c)} className="size-7 rounded-full border-2 outline-offset-2 focus-visible:outline focus-visible:outline-2" style={{ background: c, borderColor: value === c ? "#f5f5f5" : "transparent" }} />
        ))}
        <input aria-label={`${label}, custom hex colour`} value={value} onChange={(e) => onChange(e.target.value)} maxLength={7} className="h-9 w-24 rounded-md border border-border bg-surface px-2 text-sm" />
      </div>
    </div>
  );
}

export function ControlGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-4 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

/** The template controls: background, decorative typography, default portrait, information board. */
export function TemplateControls({ t, set }: { t: LeadershipTemplate; set: (next: LeadershipTemplate) => void }) {
  const upd = <S extends keyof LeadershipTemplate, K extends keyof LeadershipTemplate[S]>(section: S, key: K, value: LeadershipTemplate[S][K]) => set({ ...t, [section]: { ...t[section], [key]: value } });
  const b = t.background, ty = t.typography, p = t.portrait, bd = t.board;
  const hexOk = /^#[0-9a-fA-F]{6}$/.test(ty.color);
  return (
    <div className="space-y-5">
      <ControlGroup title="Background">
        <SelectControl label="Background colour" value={b.base} options={BASES.map((c) => ({ value: c, label: c === "#090909" ? "Black (#090909)" : c === "#141414" ? "Charcoal (#141414)" : "Graphite (#1c1c1c)" }))} onChange={(v) => upd("background", "base", v)} />
        <SelectControl label="Accent colour" value={b.accent} options={ACCENTS.map((c) => ({ value: c, label: c === "#f07832" ? "Burnt orange (#f07832)" : c === "#d95f1b" ? "Deep orange (#d95f1b)" : "Soft orange (#ff9a55)" }))} onChange={(v) => upd("background", "accent", v)} />
        <RangeControl label="Grid intensity" value={b.grid} min={0} max={100} step={1} onChange={(v) => upd("background", "grid", v)} />
        <RangeControl label="Circuit intensity" value={b.circuit} min={0} max={100} step={1} onChange={(v) => upd("background", "circuit", v)} />
        <RangeControl label="Glow intensity" value={b.glow} min={0} max={100} step={1} onChange={(v) => upd("background", "glow", v)} />
        <RangeControl label="Digital particles" value={b.particles} min={0} max={100} step={1} onChange={(v) => upd("background", "particles", v)} />
      </ControlGroup>

      <ControlGroup title="Decorative typography (behind the portrait)">
        <p className="text-xs text-fg-muted">Uses the member&apos;s name unless you give a member their own text. It is decoration only: it never changes the verified name or designation.</p>
        <SelectControl label="Font" value={ty.font} options={FONTS.map((f) => ({ value: f, label: FONT_LABELS[f] }))} onChange={(v) => upd("typography", "font", v)} />
        <SelectControl label="Weight" value={ty.weight} options={WEIGHTS.map((w) => ({ value: w, label: String(w) }))} onChange={(v) => upd("typography", "weight", v)} />
        <ColorControl label="Text colour" value={ty.color} palette={TEXT_COLORS} onChange={(v) => upd("typography", "color", v)} />
        {!hexOk && <p role="alert" className="text-xs text-danger">Use a colour like #ff9a55. The preview keeps the last valid colour.</p>}
        <RangeControl label="Font size" value={ty.size} min={8} max={40} step={0.5} onChange={(v) => upd("typography", "size", v)} unit="%" />
        <RangeControl label="Opacity" value={ty.opacity} min={0.05} max={1} step={0.01} onChange={(v) => upd("typography", "opacity", v)} />
        <RangeControl label="Letter spacing" value={ty.letterSpacing} min={-0.05} max={0.4} step={0.01} onChange={(v) => upd("typography", "letterSpacing", v)} unit="em" />
        <RangeControl label="Position, left / right" value={ty.x} min={-50} max={50} step={1} onChange={(v) => upd("typography", "x", v)} unit="%" />
        <RangeControl label="Position, up / down" value={ty.y} min={-50} max={50} step={1} onChange={(v) => upd("typography", "y", v)} unit="%" />
        <RangeControl label="Rotation" value={ty.rotation} min={-20} max={20} step={1} onChange={(v) => upd("typography", "rotation", v)} unit="°" />
        <SelectControl label="Layer order" value={ty.layer} options={[{ value: "behind", label: "Behind the portrait (above the grid)" }, { value: "back", label: "Behind everything (under grid and circuits)" }]} onChange={(v) => upd("typography", "layer", v)} />
      </ControlGroup>

      <ControlGroup title="Portrait (default for every member)">
        <p className="text-xs text-fg-muted">Upload a portrait whose background is already removed (PNG or WebP with transparency); it is shown exactly as uploaded.</p>
        <SelectControl label="Alignment" value={p.align} options={[{ value: "bottom", label: "Anchored to the bottom" }, { value: "center", label: "Centred" }]} onChange={(v) => upd("portrait", "align", v)} />
        <RangeControl label="Zoom / scale" value={p.zoom} min={0.5} max={3} step={0.01} onChange={(v) => upd("portrait", "zoom", v)} />
        <RangeControl label="Position, left / right" value={p.x} min={-50} max={50} step={1} onChange={(v) => upd("portrait", "x", v)} unit="%" />
        <RangeControl label="Position, up / down" value={p.y} min={-50} max={50} step={1} onChange={(v) => upd("portrait", "y", v)} unit="%" />
        <button type="button" onClick={() => set({ ...t, portrait: { align: "bottom", zoom: 1, x: 0, y: 0 } })} className="text-sm underline underline-offset-4">Reset portrait positioning</button>
      </ControlGroup>

      <ControlGroup title="Information board">
        <SelectControl label="Alignment" value={bd.align} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centred" }]} onChange={(v) => upd("board", "align", v)} />
        <RangeControl label="Name size" value={bd.nameSize} min={4} max={9} step={0.1} onChange={(v) => upd("board", "nameSize", v)} unit="%" />
        <RangeControl label="Detail text size" value={bd.detailSize} min={2.4} max={5} step={0.1} onChange={(v) => upd("board", "detailSize", v)} unit="%" />
        <RangeControl label="Spacing" value={bd.gap} min={0.4} max={4} step={0.1} onChange={(v) => upd("board", "gap", v)} />
        <RangeControl label="Overlap with the portrait" value={bd.overlap} min={0} max={20} step={1} onChange={(v) => upd("board", "overlap", v)} unit="%" />
        <SelectControl label="Border" value={bd.border} options={[{ value: "solid", label: "Solid line" }, { value: "double", label: "Double line" }, { value: "none", label: "No border" }]} onChange={(v) => upd("board", "border", v)} />
        <SelectControl label="Accent colour" value={bd.accent} options={ACCENTS.map((c) => ({ value: c, label: c }))} onChange={(v) => upd("board", "accent", v)} />
        <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Optional fields shown on the board">
          <ToggleControl label="Show unit / board" checked={bd.showUnit} onChange={(v) => upd("board", "showUnit", v)} />
          <ToggleControl label="Show term" checked={bd.showTerm} onChange={(v) => upd("board", "showTerm", v)} />
          <ToggleControl label="Show department" checked={bd.showDepartment} onChange={(v) => upd("board", "showDepartment", v)} />
          <ToggleControl label="Show bio" checked={bd.showBio} onChange={(v) => upd("board", "showBio", v)} />
          <ToggleControl label="Show skills" checked={bd.showSkills} onChange={(v) => upd("board", "showSkills", v)} />
          <ToggleControl label="Show public links" checked={bd.showLinks} onChange={(v) => upd("board", "showLinks", v)} />
          <ToggleControl label="Show public contact email" checked={bd.showEmail} onChange={(v) => upd("board", "showEmail", v)} />
        </div>
      </ControlGroup>
    </div>
  );
}
