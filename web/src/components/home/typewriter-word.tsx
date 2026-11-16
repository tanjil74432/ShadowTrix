"use client";

import { useEffect, useState } from "react";

/**
 * The orange word of the hero headline: types a word letter by letter with a blinking cursor, holds, deletes it letter by letter,
 * then types the next one, forever.
 *
 * - No layout shift: an invisible copy of the longest word reserves its width and the line height never changes.
 * - Server render and first paint show the first word complete, so crawlers, no-JavaScript visitors and the hydration step all see a
 *   normal headline; the animation starts after mount.
 * - `prefers-reduced-motion`: no typing, no cursor, the first word stays (and follows the setting if it changes while open).
 * - Screen readers: this whole element is `aria-hidden`; the heading carries one constant, readable sentence (see hero.tsx), so
 *   nothing is re-announced while letters change.
 */
const TYPE_MS = 85;
const DELETE_MS = 45;
const HOLD_MS = 1700;
const GAP_MS = 350;

type Phase = "type" | "hold" | "delete";

export function TypewriterWord({ words }: { words: readonly string[] }) {
  const [active, setActive] = useState(false);
  const [s, setS] = useState<{ i: number; n: number; phase: Phase }>({ i: 0, n: words[0].length, phase: "hold" });

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      setActive(!mq.matches);
      if (mq.matches) setS({ i: 0, n: words[0].length, phase: "hold" });
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [words]);

  useEffect(() => {
    if (!active) return;
    const word = words[s.i];
    let t: ReturnType<typeof setTimeout>;
    if (s.phase === "hold") {
      t = setTimeout(() => setS((p) => ({ ...p, phase: "delete" })), HOLD_MS);
    } else if (s.phase === "delete") {
      t = s.n > 0
        ? setTimeout(() => setS((p) => ({ ...p, n: p.n - 1 })), DELETE_MS)
        : setTimeout(() => setS({ i: (s.i + 1) % words.length, n: 0, phase: "type" }), GAP_MS);
    } else if (s.n < word.length) {
      t = setTimeout(() => setS((p) => ({ ...p, n: p.n + 1 })), TYPE_MS + ((s.n * 37) % 40) - 15); // slightly uneven, like a person typing
    } else {
      t = setTimeout(() => setS((p) => ({ ...p, phase: "hold" })), 0);
    }
    return () => clearTimeout(t);
  }, [s, active, words]);

  const longest = words.reduce((a, b) => (b.length > a.length ? b : a), "");
  const shown = words[s.i].slice(0, s.n);
  const typing = active && s.phase !== "hold";

  return (
    <span aria-hidden className="relative inline-grid align-baseline whitespace-nowrap">
      <span className="invisible col-start-1 row-start-1">{longest}</span>
      <span className="col-start-1 row-start-1">
        <span className="hero-word">{shown}</span>
        {active && <span className={typing ? "hero-caret" : "hero-caret hero-caret-blink"} />}
      </span>
    </span>
  );
}
