"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import {
  BANNER_H, BANNER_W, BG_TEXT_MAX, DEFAULT_BACKGROUND, FIELD_MAX, FRAME, NAME_MAX, OPACITY_RANGE, PORTRAIT_MAX_BYTES, PORTRAIT_TYPES, ROTATION_RANGE, SIZE_RANGE, TAGLINE_MAX, TEAM_MAX,
  clamp, drawBanner, type BackgroundText, type Crop,
} from "@/lib/banner/render";
import { site } from "@/lib/site";

export interface BannerSubjectProps {
  fullName: string;
  designations: { id: string; label: string }[];
}

const MAX_EDGE = 2400; // portraits are downscaled on load so phones are not asked to repaint a 40-megapixel photo
const START: Crop = { zoom: 1, x: 0, y: 0 };

type OptionalKey = "designation" | "university" | "department" | "event" | "team" | "tagline";
const SHOW_LABELS: Record<OptionalKey, string> = {
  designation: "Verified designation",
  university: "University",
  department: "Department",
  event: "Event name",
  team: "Team or organization",
  tagline: "Tagline",
};

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
  const [university, setUniversity] = useState("");
  const [department, setDepartment] = useState("");
  const [event, setEvent] = useState("");
  const [team, setTeam] = useState("");
  const [tagline, setTagline] = useState("");
  const [show, setShow] = useState<Record<OptionalKey, boolean>>({ designation: true, university: true, department: true, event: true, team: true, tagline: true });
  const [bg, setBg] = useState<BackgroundText>(DEFAULT_BACKGROUND);
  const [crop, setCrop] = useState<Crop>(START);
  const [hasPortrait, setHasPortrait] = useState(false);
  const [version, setVersion] = useState(0); // bumps when an asset (portrait, logo, fonts) becomes ready
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const designation = subject.designations.find((d) => d.id === designationId)?.label;
  const shown = (key: OptionalKey, value: string | undefined) => (show[key] && value?.trim() ? value : undefined);

  const paint = useCallback(() => {
    const cv = canvasRef.current;
    const g = cv?.getContext("2d");
    if (!cv || !g) return;
    const p = portraitRef.current;
    drawBanner(g, {
      name,
      designation: shown("designation", designation),
      university: shown("university", university),
      department: shown("department", department),
      event: shown("event", event),
      team: shown("team", team),
      tagline: shown("tagline", tagline),
      background: bg,
      crop,
      portrait: p?.img ?? null, portraitSize: p ? { w: p.w, h: p.h } : null,
      logo: logoRef.current?.complete && logoRef.current.naturalWidth ? logoRef.current : null,
      fontFamily: typeof document === "undefined" ? "sans-serif" : getComputedStyle(document.body).fontFamily || "sans-serif",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shown` only reads `show`, which is listed
  }, [name, designation, university, department, event, team, tagline, show, bg, crop]);

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
    // The canvas draws with the page font in four weights. Ask for each explicitly and repaint whenever any finishes loading, so the preview
    // never stays on a fallback font while the exported PNG (painted after the fonts are ready) uses the real one.
    const bump = () => setVersion((v) => v + 1);
    const family = getComputedStyle(document.body).fontFamily || "sans-serif";
    document.fonts?.addEventListener("loadingdone", bump);
    void Promise.all([500, 600, 700, 800].map((w) => document.fonts?.load(`${w} 24px ${family}`).catch(() => [])))
      .then(() => document.fonts?.ready)
      .then(bump);
    return () => document.fonts?.removeEventListener("loadingdone", bump);
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
  const setBgField = <K extends keyof BackgroundText>(key: K, value: BackgroundText[K]) => setBg((b) => ({ ...b, [key]: value }));
  const toggle = (key: OptionalKey) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={show[key]} onChange={(e) => setShow((s) => ({ ...s, [key]: e.target.checked }))} className="size-4 accent-[var(--color-accent)]" />
      Show {SHOW_LABELS[key].toLowerCase()}
    </label>
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
      <div className="order-2 space-y-5 lg:order-1">
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

        <fieldset className="space-y-3 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium">Identity text</legend>
          <Field label="Identity text" hint="Large lettering above your photo, for example FOUNDER, MY TEAM or anything you like. It is decoration only: not a verified role, and it gives no access.">
            {(c) => <Input {...c} value={bg.text} maxLength={BG_TEXT_MAX} onChange={(e) => setBgField("text", e.target.value)} autoComplete="off" />}
          </Field>
          <label className="block text-sm">Text size
            <input type="range" min={SIZE_RANGE.min} max={SIZE_RANGE.max} step={2} value={bg.size} onChange={(e) => setBgField("size", Number(e.target.value))} className={slider} />
          </label>
          <label className="block text-sm">Text position left / right
            <input type="range" min={-1} max={1} step={0.01} value={bg.x} onChange={(e) => setBgField("x", Number(e.target.value))} className={slider} />
          </label>
          <label className="block text-sm">Text position up / down
            <input type="range" min={-1} max={1} step={0.01} value={bg.y} onChange={(e) => setBgField("y", Number(e.target.value))} className={slider} />
          </label>
          <label className="block text-sm">Text opacity
            <input type="range" min={OPACITY_RANGE.min} max={OPACITY_RANGE.max} step={0.01} value={bg.opacity} onChange={(e) => setBgField("opacity", Number(e.target.value))} className={slider} />
          </label>
          <label className="block text-sm">Text rotation
            <input type="range" min={ROTATION_RANGE.min} max={ROTATION_RANGE.max} step={1} value={bg.rotation} onChange={(e) => setBgField("rotation", Number(e.target.value))} className={slider} />
          </label>
          <Button type="button" variant="secondary" size="sm" onClick={() => setBg(DEFAULT_BACKGROUND)}>Reset identity text</Button>
        </fieldset>

        <Field label="Name" required>
          {(c) => <Input {...c} value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
        </Field>
        <fieldset className="space-y-2 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium">Show on banner</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(SHOW_LABELS) as OptionalKey[]).map((k) => <div key={k}>{toggle(k)}</div>)}
          </div>
          <p className="text-xs text-fg-muted">Untick anything you prefer to leave off. Your name is always shown.</p>
        </fieldset>
        <Field
          label="Designation"
          hint={subject.designations.length ? "Verified designation: only designations approved for this person are offered." : "No approved designation is on record, so the banner shows no designation."}
        >
          {(c) => (
            <Select {...c} value={designationId} onChange={(e) => setDesignationId(e.target.value)} disabled={subject.designations.length === 0}>
              <option value="">None</option>
              {subject.designations.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="University name">
          {(c) => <Input {...c} value={university} maxLength={FIELD_MAX} onChange={(e) => setUniversity(e.target.value)} autoComplete="organization" />}
        </Field>
        <Field label="Department">
          {(c) => <Input {...c} value={department} maxLength={FIELD_MAX} onChange={(e) => setDepartment(e.target.value)} autoComplete="off" />}
        </Field>
        <Field label="Event name">
          {(c) => <Input {...c} value={event} maxLength={FIELD_MAX} onChange={(e) => setEvent(e.target.value)} autoComplete="off" />}
        </Field>
        <Field label="Team or organization name">
          {(c) => <Input {...c} value={team} maxLength={TEAM_MAX} onChange={(e) => setTeam(e.target.value)} autoComplete="off" />}
        </Field>
        <Field label="Tagline" hint={`Up to ${TAGLINE_MAX} characters.`}>
          {(c) => <Input {...c} value={tagline} maxLength={TAGLINE_MAX} onChange={(e) => setTagline(e.target.value)} autoComplete="off" />}
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
          aria-label={`Banner preview for ${name || "your name"}${shown("designation", designation) ? `, ${designation}` : ""}${bg.text.trim() ? `, identity text ${bg.text.trim()}` : ""}`}
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
