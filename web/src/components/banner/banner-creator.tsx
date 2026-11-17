"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { drawBanner, BANNER_H, BANNER_W, FRAME, NAME_MAX, PORTRAIT_MAX_BYTES, PORTRAIT_TYPES, TAGLINE_MAX, clamp, type Crop } from "@/lib/banner/render";
import { TEMPLATES, type TemplateId } from "@/lib/banner/templates";
import { site } from "@/lib/site";

export interface BannerSubjectProps {
  fullName: string;
  designations: { id: string; label: string }[];
  /** Templates this person may use (decided on the server from real records). Never empty: participant is always allowed. */
  templates: TemplateId[];
  /** Events this person is genuinely linked to. */
  events: { id: string; title: string }[];
}

const MAX_EDGE = 2400; // portraits are downscaled on load so phones are not asked to repaint a 40-megapixel photo
const START: Crop = { zoom: 1, x: 0, y: 0 };

async function loadPortrait(file: File): Promise<{ img: ImageBitmap | HTMLImageElement; w: number; h: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      const full = await createImageBitmap(file, { imageOrientation: "from-image" });
      const big = Math.max(full.width, full.height);
      if (big <= MAX_EDGE) return { img: full, w: full.width, h: full.height };
      const k = MAX_EDGE / big;
      const w = Math.round(full.width * k), h = Math.round(full.height * k);
      const small = await createImageBitmap(full, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
      full.close();
      return { img: small, w, h };
    } catch {
      /* fall through to the <img> path */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { img, w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function BannerCreator({ subject }: { subject: BannerSubjectProps }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoRef = useRef<HTMLImageElement | null>(null);
  const portraitRef = useRef<{ img: ImageBitmap | HTMLImageElement; w: number; h: number } | null>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const raf = useRef(0);
  const [name, setName] = useState(subject.fullName.slice(0, NAME_MAX));
  const [designationId, setDesignationId] = useState(subject.designations[0]?.id ?? "");
  const [tagline, setTagline] = useState("");
  const allowed = subject.templates.length ? subject.templates : (["participant"] as TemplateId[]);
  const [template, setTemplate] = useState<TemplateId>(allowed[0]);
  const [eventId, setEventId] = useState("");
  const [crop, setCrop] = useState<Crop>(START);
  const [hasPortrait, setHasPortrait] = useState(false);
  const [version, setVersion] = useState(0); // bumps when an asset (portrait, logo, fonts) becomes ready
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const designation = subject.designations.find((d) => d.id === designationId)?.label;
  const event = subject.events.find((e) => e.id === eventId)?.title;

  const paint = useCallback(() => {
    const cv = canvasRef.current;
    const g = cv?.getContext("2d");
    if (!cv || !g) return;
    const p = portraitRef.current;
    drawBanner(g, {
      template, name, designation, event, organization: site.operator, tagline, crop,
      portrait: p?.img ?? null, portraitSize: p ? { w: p.w, h: p.h } : null,
      logo: logoRef.current?.complete && logoRef.current.naturalWidth ? logoRef.current : null,
      fontFamily: typeof document === "undefined" ? "sans-serif" : getComputedStyle(document.body).fontFamily || "sans-serif",
    });
  }, [template, name, designation, event, tagline, crop]);

  useEffect(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf.current);
  }, [paint, version]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setVersion((v) => v + 1);
    img.src = site.logo.src;
    logoRef.current = img;
    void document.fonts?.ready.then(() => setVersion((v) => v + 1));
  }, []);

  async function onFile(file: File | undefined) {
    setError("");
    if (!file) return;
    if (!(PORTRAIT_TYPES as readonly string[]).includes(file.type)) return setError("Choose a JPEG, PNG or WebP image.");
    if (file.size > PORTRAIT_MAX_BYTES) return setError("That image is larger than 12 MB. Choose a smaller one.");
    try {
      const p = await loadPortrait(file);
      portraitRef.current = p;
      setHasPortrait(true);
      setCrop(START);
      setVersion((v) => v + 1);
      setStatus("Portrait added. Use the sliders or drag the preview to position it.");
    } catch {
      setError("That image could not be read. Try another file.");
    }
  }

  function overflow() {
    const p = portraitRef.current;
    if (!p) return { ox: 0, oy: 0 };
    const scale = Math.max(FRAME.w / p.w, FRAME.h / p.h) * crop.zoom;
    return { ox: (p.w * scale - FRAME.w) / 2, oy: (p.h * scale - FRAME.h) / 2 };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!hasPortrait) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: crop.x, y: crop.y };
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (!d) return;
    const k = BANNER_W / e.currentTarget.getBoundingClientRect().width; // screen px -> canvas px
    const { ox, oy } = overflow();
    setCrop((c) => ({
      ...c,
      x: ox > 0 ? clamp(d.x - ((e.clientX - d.px) * k) / ox, -1, 1) : 0,
      y: oy > 0 ? clamp(d.y - ((e.clientY - d.py) * k) / oy, -1, 1) : 0,
    }));
  }

  async function exportPng() {
    setError("");
    await document.fonts?.ready;
    paint();
    const cv = canvasRef.current;
    if (!cv) return;
    cv.toBlob((blob) => {
      if (!blob) return setError("The image could not be created. Try again.");
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "member";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `shadowtrix-banner-${slug}.png`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setStatus(`Downloaded ${BANNER_W} × ${BANNER_H} PNG.`);
    }, "image/png");
  }

  const slider = "w-full accent-[var(--color-accent)] disabled:opacity-40";
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
      <div className="space-y-5 order-2 lg:order-1">
        <fieldset className="space-y-2 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium">Template</legend>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Banner template">
            {allowed.map((id) => (
              <label key={id} className={`cursor-pointer rounded-md border px-3 py-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-accent)] ${template === id ? "border-[var(--color-accent)] bg-surface-2 font-semibold" : "border-border"}`}>
                <input type="radio" name="banner-template" value={id} checked={template === id} onChange={() => setTemplate(id)} className="sr-only" />
                {TEMPLATES[id].label}
              </label>
            ))}
          </div>
          <p className="text-xs text-fg-muted">{allowed.length > 1 ? "Only templates that match your role on ShadowTrix are offered." : "Role templates appear here once your role on ShadowTrix is on record."}</p>
        </fieldset>
        <Field label="Portrait" hint="JPEG, PNG or WebP, up to 12 MB. The photo stays in your browser and is never uploaded.">
          {(c) => (
            <input
              {...c}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => void onFile(e.target.files?.[0])}
              className="block w-full text-sm text-fg-muted"
            />
          )}
        </Field>
        <fieldset className="space-y-3 rounded-lg border border-border p-4" disabled={!hasPortrait}>
          <legend className="px-1 text-sm font-medium">Crop and position</legend>
          <label className="block text-sm">Zoom
            <input type="range" min={1} max={3} step={0.01} value={crop.zoom} onChange={(e) => setCrop((c) => ({ ...c, zoom: Number(e.target.value) }))} className={slider} />
          </label>
          <label className="block text-sm">Left / right
            <input type="range" min={-1} max={1} step={0.01} value={crop.x} onChange={(e) => setCrop((c) => ({ ...c, x: Number(e.target.value) }))} className={slider} />
          </label>
          <label className="block text-sm">Up / down
            <input type="range" min={-1} max={1} step={0.01} value={crop.y} onChange={(e) => setCrop((c) => ({ ...c, y: Number(e.target.value) }))} className={slider} />
          </label>
          <Button type="button" variant="secondary" size="sm" onClick={() => setCrop(START)}>Reset zoom and position</Button>
        </fieldset>
        <Field label="Name" required>
          {(c) => <Input {...c} value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
        </Field>
        <Field
          label="Designation"
          hint={subject.designations.length ? "Only designations approved for this person are offered." : "No approved designation is on record, so the banner shows the name only."}
        >
          {(c) => (
            <Select {...c} value={designationId} onChange={(e) => setDesignationId(e.target.value)} disabled={subject.designations.length === 0}>
              <option value="">None</option>
              {subject.designations.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Event" hint={subject.events.length ? "Only events you take part in are offered." : "No event is linked to your account yet."}>
          {(c) => (
            <Select {...c} value={eventId} onChange={(e) => setEventId(e.target.value)} disabled={subject.events.length === 0}>
              <option value="">None</option>
              {subject.events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Tagline" hint={`Up to ${TAGLINE_MAX} characters.`}>
          {(c) => <Input {...c} value={tagline} maxLength={TAGLINE_MAX} onChange={(e) => setTagline(e.target.value)} />}
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => void exportPng()}>Download PNG ({BANNER_W} × {BANNER_H})</Button>
        </div>
        <p role="alert" className="min-h-5 text-sm text-danger">{error}</p>
        <p role="status" className="sr-only">{status}</p>
        <p className="text-xs text-fg-muted">A banner is only a picture. It is not an official record and does not give anyone any access or permission on ShadowTrix.</p>
      </div>
      <div className="order-1 mx-auto w-full max-w-[34rem] lg:order-2 lg:sticky lg:top-24">
        <canvas
          ref={canvasRef}
          width={BANNER_W}
          height={BANNER_H}
          role="img"
          aria-label={`${TEMPLATES[template].label} banner preview for ${name || "your name"}${designation ? `, ${designation}` : ""}${event ? `, ${event}` : ""}`}
          data-testid="banner-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          className={`h-auto w-full rounded-lg shadow-card ${hasPortrait ? "cursor-grab touch-none active:cursor-grabbing" : ""}`}
          style={{ aspectRatio: `${BANNER_W} / ${BANNER_H}` }}
        />
        {hasPortrait && <p className="mt-2 text-center text-xs text-fg-muted">Drag the preview to reposition the portrait.</p>}
      </div>
    </div>
  );
}
