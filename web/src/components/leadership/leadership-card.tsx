import type { CSSProperties, ReactNode } from "react";
import { FONT_STACKS, type LeadershipTemplate, type MemberStyle } from "@/lib/leadership/template";

/** What the card shows. Only fields that are already public for a verified, published member (see getPublicTeam). */
export interface CardPerson {
  id: string;
  name: string;
  designation: string;
  unitName?: string | null;
  term?: string | null;
  department?: string | null;
  bio?: string | null;
  skills?: string[];
  links?: { linkedin?: string | null; github?: string | null; portfolio?: string | null };
  /** Only when the member chose to make it public. */
  email?: string | null;
  /** URL of the uploaded portrait (transparent PNG/WebP), or null. */
  photoSrc: string | null;
}

const rgb = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** Deterministic pseudo-random numbers, so the artwork is identical on the server, in the browser and in every card. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Right-angle circuit traces and pads along the card's edges, in a 100 x 125 box. Computed once. */
const CIRCUITS = (() => {
  const r = rng(20261118);
  const paths: string[] = [];
  const pads: { x: number; y: number }[] = [];
  for (let k = 0; k < 16; k++) {
    const left = k % 2 === 0;
    let x = left ? 2 + r() * 14 : 84 + r() * 14;
    let y = 4 + r() * 117;
    let horizontal = r() < 0.5;
    let d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
    for (let s = 0, n = 3 + Math.floor(r() * 3); s < n; s++) {
      const len = 4 + r() * 12;
      const dir = r() < 0.5 ? -1 : 1;
      if (horizontal) x = Math.min(left ? 22 : 98, Math.max(left ? 2 : 78, x + dir * len));
      else y = Math.min(121, Math.max(4, y + dir * len));
      d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
      horizontal = !horizontal;
    }
    paths.push(d);
    pads.push({ x, y });
  }
  return { paths, pads };
})();

/** Faint "data stream" dashes and dots across the whole card. */
const PARTICLES = (() => {
  const r = rng(77123);
  return Array.from({ length: 46 }, (_, i) => ({ x: r() * 100, y: r() * 125, len: i % 3 === 0 ? 3 + r() * 9 : 0, o: 0.25 + r() * 0.75 }));
})();

export interface LeadershipCardProps {
  person: CardPerson;
  template: LeadershipTemplate;
  style?: Partial<MemberStyle> | null;
  /** First images on a page can ask the browser to load them eagerly. */
  eager?: boolean;
  className?: string;
}

/**
 * The Universal Matrix Leadership Template, as one reusable component: a ShadowTrix Matrix background, large decorative text BEHIND the
 * (transparent) portrait, and an information board at the bottom. Sizes use the card's own width (cqw), so the same card is correct in the
 * admin preview, the homepage grid and the Leadership Board at any width. Optional fields that are missing or switched off leave no row.
 * The decorative text is visual only (aria-hidden) and never changes the verified name or designation.
 */
export function LeadershipCard({ person, template: t, style, eager, className }: LeadershipCardProps) {
  const bg = t.background, ty = t.typography, board = t.board;
  const m = { zoom: 1, x: 0, y: 0, text: "", textX: 0, textY: 0, textScale: 1, ...(style ?? {}) };
  const accent = bg.accent;

  // Decorative text: the member's own name unless customised. Oversized lettering that runs past the card edges is intended; only an extreme overflow is shrunk.
  const text = (m.text.trim() || person.name).slice(0, 40);
  const wanted = ty.size * m.textScale;
  const size = wanted * Math.min(1, 200 / Math.max(1, text.length * 0.62 * wanted)); // the size control decides; only extreme overflow is reined in

  const decorative = (
    <div
      aria-hidden="true"
      data-testid="leadership-decorative-text"
      className="pointer-events-none absolute select-none whitespace-nowrap"
      style={{
        left: `${50 + ty.x + m.textX}%`,
        top: `${44 + ty.y + m.textY}%`,
        transform: `translate(-50%, -50%) rotate(${ty.rotation}deg)`,
        fontFamily: FONT_STACKS[ty.font],
        fontWeight: ty.weight,
        fontSize: `${size}cqw`,
        lineHeight: 1,
        letterSpacing: `${ty.letterSpacing}em`,
        color: ty.color,
        opacity: ty.opacity,
        textShadow: `0 0 ${2.2 * (bg.glow / 60)}cqw ${rgb(accent, 0.55)}`,
      }}
    >
      {text}
    </div>
  );

  const isBack = ty.layer === "back";
  const rows: { key: string; node: ReactNode }[] = [];
  if (board.showUnit && person.unitName) rows.push({ key: "unit", node: <p style={{ color: rgb("#d4d4d4", 0.95) }}>{person.unitName}{board.showTerm && person.term ? `  ·  ${person.term}` : ""}</p> });
  else if (board.showTerm && person.term) rows.push({ key: "term", node: <p style={{ color: rgb("#d4d4d4", 0.95) }}>{person.term}</p> });
  if (board.showDepartment && person.department) rows.push({ key: "dept", node: <p style={{ color: rgb("#a3a3a3", 1) }}>{person.department}</p> });
  if (board.showBio && person.bio) rows.push({ key: "bio", node: <p className="line-clamp-3" style={{ color: rgb("#a3a3a3", 1) }}>{person.bio}</p> });
  if (board.showSkills && person.skills && person.skills.length > 0) rows.push({ key: "skills", node: <p style={{ color: rgb("#a3a3a3", 1) }}>{person.skills.join(", ")}</p> });
  if (board.showEmail && person.email) rows.push({ key: "email", node: <p><a href={`mailto:${person.email}`} className="underline underline-offset-2" style={{ color: rgb(board.accent, 1) }}>{person.email}</a></p> });
  const links = [["LinkedIn", person.links?.linkedin], ["GitHub", person.links?.github], ["Portfolio", person.links?.portfolio]].filter((l): l is [string, string] => !!l[1]);
  if (board.showLinks && links.length > 0) {
    rows.push({ key: "links", node: <p className="flex flex-wrap gap-x-[2.4cqw]">{links.map(([label, href]) => <a key={label} href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2" style={{ color: rgb(board.accent, 1) }}>{label}</a>)}</p> });
  }

  const boardBorder: CSSProperties =
    board.border === "none" ? {} : board.border === "double" ? { border: `0.5cqw double ${rgb(board.accent, 0.85)}` } : { border: `0.35cqw solid ${rgb(board.accent, 0.7)}` };
  const center = board.align === "center";

  return (
    <article
      data-testid="leadership-card"
      aria-label={`${person.name}, ${person.designation}`}
      className={`relative isolate flex aspect-[4/5] w-full flex-col overflow-clip rounded-xl border border-white/10 ${className ?? ""}`}
      style={{ containerType: "inline-size", background: bg.base }}
    >
      {/* Background: ambient light, then (optionally) the text, grid, circuits and particles. All decorative. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={{ background: `radial-gradient(circle at 50% 36%, ${rgb(accent, 0.5 * (bg.glow / 100))} 0, transparent 58%), radial-gradient(circle at 100% 100%, ${rgb(accent, 0.45 * (bg.glow / 100))} 0, transparent 55%), radial-gradient(circle at 0% 0%, ${rgb(accent, 0.22 * (bg.glow / 100))} 0, transparent 45%)` }} />
      {isBack && decorative}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ opacity: (bg.grid / 100) * 0.5, backgroundImage: `repeating-linear-gradient(0deg, ${rgb(accent, 0.55)} 0 1px, transparent 1px 8cqw), repeating-linear-gradient(90deg, ${rgb(accent, 0.55)} 0 1px, transparent 1px 8cqw)` }} />
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 125" preserveAspectRatio="none" style={{ opacity: (bg.circuit / 100) * 0.75 }}>
        {CIRCUITS.paths.map((d, i) => <path key={i} d={d} fill="none" stroke={accent} strokeWidth="1.1" vectorEffect="non-scaling-stroke" />)}
        {CIRCUITS.pads.map((p, i) => <g key={i}><circle cx={p.x} cy={p.y} r="0.9" fill={ACCENT_SOFT} /><circle cx={p.x} cy={p.y} r="1.9" fill="none" stroke={accent} strokeWidth="0.6" vectorEffect="non-scaling-stroke" /></g>)}
      </svg>
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 125" preserveAspectRatio="none" style={{ opacity: (bg.particles / 100) * 0.8 }}>
        {PARTICLES.map((p, i) => p.len > 0
          ? <line key={i} x1={p.x} y1={p.y} x2={p.x} y2={p.y + p.len} stroke={accent} strokeWidth="0.5" opacity={p.o} vectorEffect="non-scaling-stroke" />
          : <circle key={i} cx={p.x} cy={p.y} r="0.45" fill={ACCENT_SOFT} opacity={p.o} />)}
      </svg>
      {!isBack && decorative}

      {/* Portrait stage: the uploaded portrait has its background already removed, so the transparency lets the text and background show. */}
      <div className="relative z-10 min-h-0 flex-1" data-testid="leadership-stage">
        {person.photoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- a transparent portrait served as-is by the API; the image optimiser would re-encode it
          <img
            src={person.photoSrc}
            alt={`Photo of ${person.name}`}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            data-testid="leadership-portrait"
            className="absolute max-w-none select-none"
            style={{
              height: `${100 * t.portrait.zoom * m.zoom}%`,
              width: "auto",
              left: `${50 + t.portrait.x + m.x}%`,
              ...(t.portrait.align === "bottom" ? { bottom: `${-(t.portrait.y + m.y)}%`, transform: "translateX(-50%)" } : { top: `${50 + t.portrait.y + m.y}%`, transform: "translate(-50%, -50%)" }),
              filter: `drop-shadow(0 0 1.4cqw ${rgb(accent, 0.38)}) drop-shadow(0 0.6cqw 1.2cqw rgba(0,0,0,0.55))`,
            }}
          />
        ) : (
          <svg aria-hidden="true" viewBox="0 0 100 100" className="absolute left-1/2 bottom-0 h-[78%] -translate-x-1/2" fill={rgb(accent, 0.4)}>
            <circle cx="50" cy="30" r="16" /><path d="M14 100c0-24 15-38 36-38s36 14 36 38z" />
          </svg>
        )}
      </div>

      {/* Information board */}
      <div
        data-testid="leadership-board"
        className="relative z-20 mx-[3cqw] mb-[3cqw] rounded-lg"
        style={{
          marginTop: `-${board.overlap}cqw`,
          padding: "3.6cqw 4.2cqw",
          textAlign: board.align,
          background: "linear-gradient(135deg, rgba(24,14,9,0.94), rgba(9,9,9,0.96))",
          boxShadow: `0 0 4cqw ${rgb(board.accent, 0.28)}`,
          ...boardBorder,
        }}
      >
        <h3 style={{ fontSize: `max(${board.nameSize}cqw, 17px)`, lineHeight: 1.08, fontWeight: 800, color: "#f5f5f5", overflowWrap: "anywhere" }}>{person.name}</h3>
        <div aria-hidden="true" style={{ height: "0.7cqw", width: "16cqw", margin: `${board.gap * 0.9}cqw ${center ? "auto" : "0"} ${board.gap}cqw`, background: `linear-gradient(90deg, ${board.accent}, ${ACCENT_SOFT})` }} />
        <p style={{ fontSize: `max(${board.detailSize * 1.12}cqw, 13px)`, fontWeight: 700, color: ACCENT_SOFT, lineHeight: 1.2 }}>{person.designation}</p>
        {rows.length > 0 && (
          <div style={{ marginTop: `${board.gap * 0.7}cqw`, fontSize: `max(${board.detailSize}cqw, 12px)`, lineHeight: 1.25, display: "grid", gap: `${board.gap * 0.45}cqw` }}>
            {rows.map((r) => <div key={r.key} data-testid="leadership-row">{r.node}</div>)}
          </div>
        )}
      </div>
    </article>
  );
}

const ACCENT_SOFT = "#ff9a55";
