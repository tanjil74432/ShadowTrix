/**
 * A simple, accessible bar chart: every bar has its label and exact number as TEXT (the visual bar is decoration), so the
 * data is available to screen readers and to people who cannot judge lengths. No chart library.
 */
export function BarList({ title, rows, unit = "" }: { title: string; rows: { label: string; value: number }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure className="rounded-lg bg-surface p-5 shadow-card">
      <figcaption className="font-semibold">{title}</figcaption>
      {rows.length === 0 || rows.every((r) => r.value === 0) ? (
        <p className="mt-3 text-sm text-fg-muted">No data in this period.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((r) => (
            <li key={r.label} className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate" title={r.label}>{r.label}</span>
              <span aria-hidden className="h-2.5 rounded-full bg-surface-raised shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]"><span className="block h-full origin-left animate-grow-x rounded-full bg-gradient-to-r from-accent-deep to-accent-soft shadow-glow-soft" style={{ width: `${(r.value / max) * 100}%` }} /></span>
              <span className="tabular-nums font-medium text-accent-soft">{r.value}{unit}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

/** Column chart for a daily series. The numbers are also available as a visually hidden table. */
export function DailyChart({ title, series }: { title: string; series: { day: string; count: number }[] }) {
  const max = Math.max(1, ...series.map((s) => s.count));
  const total = series.reduce((n, s) => n + s.count, 0);
  return (
    <figure className="rounded-lg bg-surface p-5 shadow-card">
      <figcaption className="font-semibold">{title} <span className="font-normal text-fg-muted">({total} in total)</span></figcaption>
      <div aria-hidden className="mt-4 flex h-32 items-end gap-px border-b border-accent/30 bg-[repeating-linear-gradient(to_top,transparent_0,transparent_31px,rgb(255_255_255/0.05)_31px,rgb(255_255_255/0.05)_32px)]">
        {series.map((s) => (
          <span key={s.day} title={`${s.day}: ${s.count}`} className="flex-1 rounded-t-sm bg-gradient-to-t from-accent-deep to-accent-soft transition-[filter] duration-(--duration-fast) hover:brightness-125" style={{ height: `${Math.max(s.count ? 4 : 1, (s.count / max) * 100)}%`, opacity: s.count ? 1 : 0.25 }} />
        ))}
      </div>
      <p className="mt-2 flex justify-between text-xs text-fg-subtle" aria-hidden><span>{series[0]?.day}</span><span>{series.at(-1)?.day}</span></p>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th scope="col">Day</th><th scope="col">Count</th></tr></thead>
        <tbody>{series.filter((s) => s.count > 0).map((s) => <tr key={s.day}><th scope="row">{s.day}</th><td>{s.count}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
