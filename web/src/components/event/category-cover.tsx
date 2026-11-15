import { cn } from "@/lib/cn";

/** Small deterministic PRNG so a given slug always draws the same pattern (stable SSR output). */
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * Generated cover art in the ShadowTrix visual language (grid + connected nodes).
 * Used when an event has no uploaded image, so we never show stock photos or fake imagery.
 * Always 16:9; decorative (aria-hidden).
 */
export function CategoryCover({ seed, className }: { seed: string; className?: string }) {
  const rand = seeded(seed);
  const W = 320;
  const H = 180;
  const nodes = Array.from({ length: 9 }, () => ({ x: 24 + rand() * (W - 48), y: 20 + rand() * (H - 40), r: 1.6 + rand() * 2.4 }));
  const edges: [number, number][] = [];
  nodes.forEach((a, i) => {
    const nearest = nodes
      .map((b, j) => ({ j, d: (a.x - b.x) ** 2 + (a.y - b.y) ** 2 }))
      .filter((n) => n.j !== i)
      .sort((p, q) => p.d - q.d)
      .slice(0, 2);
    nearest.forEach((n) => {
      if (!edges.some(([p, q]) => (p === i && q === n.j) || (p === n.j && q === i))) edges.push([i, n.j]);
    });
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      focusable="false"
      className={cn("block h-full w-full bg-surface", className)}
    >
      <defs>
        <pattern id={`g-${seed}`} width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="white" strokeOpacity="0.06" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill={`url(#g-${seed})`} />
      {edges.map(([a, b]) => (
        <line key={`${a}-${b}`} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y} stroke="white" strokeOpacity="0.28" strokeWidth="0.8" />
      ))}
      {nodes.map((n, i) => (
        <circle key={i} cx={n.x} cy={n.y} r={n.r} fill="white" fillOpacity={0.55 + (i % 3) * 0.15} />
      ))}
    </svg>
  );
}
