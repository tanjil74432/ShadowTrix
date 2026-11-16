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

  // Roughly every third node is orange; the first orange nodes breathe and one edge carries a slow pulse of light.
  const hot = new Set(nodes.map((_, i) => i).filter((i) => i % 3 === 0));
  const flowEdge = edges.length > 2 ? 1 : -1;
  const glow = nodes[Math.floor(rand() * nodes.length)];

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
        <radialGradient id={`o-${seed}`} cx={glow.x} cy={glow.y} r="130" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#d95f1b" stopOpacity="0.34" />
          <stop offset="1" stopColor="#d95f1b" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`f-${seed}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.6" stopColor="#141414" stopOpacity="0" />
          <stop offset="1" stopColor="#141414" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="#0e0e0e" />
      <rect width={W} height={H} fill={`url(#o-${seed})`} />
      <rect width={W} height={H} fill={`url(#g-${seed})`} />
      {edges.map(([a, b]) => {
        const lit = hot.has(a) || hot.has(b);
        return (
          <line key={`${a}-${b}`} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
            stroke={lit ? "#f07832" : "white"} strokeOpacity={lit ? 0.5 : 0.2} strokeWidth="0.8" />
        );
      })}
      {flowEdge >= 0 && (
        <line x1={nodes[edges[flowEdge][0]].x} y1={nodes[edges[flowEdge][0]].y} x2={nodes[edges[flowEdge][1]].x} y2={nodes[edges[flowEdge][1]].y}
          stroke="#ff9a55" strokeOpacity="0.9" strokeWidth="1.2" strokeDasharray="6 34" className="animate-edge-flow" />
      )}
      {nodes.map((n, i) =>
        hot.has(i) ? (
          <g key={i}>
            <circle cx={n.x} cy={n.y} r={n.r + 3} fill="#f07832" className={i === 0 ? "animate-node-pulse [transform-box:fill-box] origin-center" : undefined} fillOpacity={i === 0 ? undefined : 0.18} />
            <circle cx={n.x} cy={n.y} r={n.r + 0.4} fill="#f07832" />
          </g>
        ) : (
          <circle key={i} cx={n.x} cy={n.y} r={n.r} fill="white" fillOpacity={0.5 + (i % 3) * 0.15} />
        ),
      )}
      <rect width={W} height={H} fill={`url(#f-${seed})`} />
    </svg>
  );
}
