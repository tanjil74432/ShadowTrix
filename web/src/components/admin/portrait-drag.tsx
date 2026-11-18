"use client";

import { useEffect, useRef, useState } from "react";

/** The most the portrait may be moved, as a percentage of its own size, in each direction. Matches what the server accepts (see memberStyleSchema). */
export const DRAG_LIMIT = 50;
const clamp = (v: number) => Math.max(-DRAG_LIMIT, Math.min(DRAG_LIMIT, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

export interface DragValue { x: number; y: number }

/**
 * A transparent layer over the card preview that lets the administrator pick the portrait up and move it: press and hold on the card (mouse,
 * finger or pen), drag in any direction, release. The portrait follows the pointer one to one, at any zoom, because the distance moved is converted
 * with the portrait's real on-screen size. The position is kept within +-50% of the portrait's own size, so it can never be lost off the card; the
 * arrow keys nudge it (Shift = bigger steps) and the "Reset portrait positioning" control always brings it back.
 *
 * The layer owns the pointer: the browser's own image dragging, text selection, scrolling and touch panning are switched off for it, and the move
 * and release are listened to on the window, so the drag keeps working when the pointer leaves the card.
 */
export function PortraitDragLayer({ value, onChange, label = "Portrait position" }: { value: DragValue; onChange: (v: DragValue) => void; label?: string }) {
  const layer = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const live = useRef({ value, onChange });
  useEffect(() => { live.current = { value, onChange }; }); // the handlers always see the latest value and callback
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  /** The portrait's size before zoom and position, in screen pixels (its box includes the zoom, which the card publishes as data-zoom). */
  function portraitSize(): { w: number; h: number } | null {
    const img = layer.current?.parentElement?.querySelector<HTMLElement>('[data-testid="leadership-portrait"]');
    if (!img) return null;
    const r = img.getBoundingClientRect();
    const zoom = Number(img.dataset.zoom) || 1;
    return r.width > 0 && r.height > 0 ? { w: r.width / zoom, h: r.height / zoom } : null;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return; // only the primary button
    const size = portraitSize();
    if (!size) return;
    e.preventDefault();
    layer.current?.focus({ preventScroll: true });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not every pointer can be captured; the window listeners below still follow it */ }
    const start = { px: e.clientX, py: e.clientY, x: live.current.value.x, y: live.current.value.y, id: e.pointerId };
    setDragging(true);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== start.id) return;
      ev.preventDefault();
      live.current.onChange({
        x: round1(clamp(start.x + ((ev.clientX - start.px) / size.w) * 100)),
        y: round1(clamp(start.y + ((ev.clientY - start.py) / size.h) * 100)),
      });
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== start.id) return;
      cleanup.current?.();
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    cleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      cleanup.current = null;
      setDragging(false);
    };
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 5 : 1;
    const d = e.key === "ArrowLeft" ? [-step, 0] : e.key === "ArrowRight" ? [step, 0] : e.key === "ArrowUp" ? [0, -step] : e.key === "ArrowDown" ? [0, step] : null;
    if (!d) return;
    e.preventDefault();
    const v = live.current.value;
    live.current.onChange({ x: round1(clamp(v.x + d[0])), y: round1(clamp(v.y + d[1])) });
  }

  return (
    <div
      ref={layer}
      role="group"
      tabIndex={0}
      aria-label={`${label}: drag the portrait with the mouse or your finger, or use the arrow keys`}
      data-testid="portrait-drag-layer"
      data-dragging={dragging ? "true" : "false"}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDragStart={(e) => e.preventDefault()}
      className="absolute inset-0 z-30 select-none rounded-xl outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
      style={{ cursor: dragging ? "grabbing" : "grab", touchAction: "none", WebkitUserSelect: "none", userSelect: "none" }}
    />
  );
}
