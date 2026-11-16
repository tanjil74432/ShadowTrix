import Link from "next/link";
import type { ReactNode } from "react";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";

/** Small building blocks shared by the administration pages, so every page has the same heading, breadcrumbs, table and filters. */
export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
export const adminFallback = <Container className="py-14"><Skeleton className="h-96 w-full" /></Container>;

export function hrefWith(base: string, params: Record<string, string | undefined>, page?: number) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  if (page && page > 1) sp.set("page", String(page));
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

export function Crumbs({ trail }: { trail: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 text-sm text-fg-subtle">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li><Link href="/admin" className="underline-offset-4 hover:underline">Administration</Link></li>
        {trail.map((t, i) => (
          <li key={t.label} className="flex items-center gap-1.5">
            <span aria-hidden>/</span>
            {t.href && i < trail.length - 1 ? <Link href={t.href} className="underline-offset-4 hover:underline">{t.label}</Link> : <span aria-current={i === trail.length - 1 ? "page" : undefined} className="text-fg-muted">{t.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeading({ title, intro, trail, actions }: { title: string; intro?: string; trail?: { label: string; href?: string }[]; actions?: ReactNode }) {
  return (
    <header className="mb-6">
      <Crumbs trail={trail ?? [{ label: title }]} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h1 font-semibold">{title}</h1>
          {intro && <p className="mt-2 max-w-2xl text-fg-muted">{intro}</p>}
        </div>
        {actions}
      </div>
    </header>
  );
}

/** A scrollable, captioned table with column headers. Rows are passed as children. */
export function DataTable({ caption, columns, minWidth = "48rem", children }: { caption: string; columns: string[]; minWidth?: string; children: ReactNode }) {
  return (
    <div tabIndex={0} role="region" aria-label={`${caption} (scrollable table)`} className="mt-4 overflow-x-auto rounded-lg shadow-card">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-border-strong text-fg-subtle">
          <tr>{columns.map((c) => <th key={c} scope="col" className="px-4 py-3 font-medium">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export const cell = "px-4 py-3";

/** Status chip: text first (never colour alone). */
export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const tones = { neutral: "border-border-strong text-fg-muted", good: "border-accent/60 text-accent-soft", warn: "border-warning/60 text-warning", bad: "border-danger/60 text-danger" } as const;
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}><dt className="text-sm text-fg-subtle">{k}</dt><dd className="mt-0.5">{v ?? <span className="text-fg-subtle">Not set</span>}</dd></div>
      ))}
    </dl>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="text-h3 font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function HistoryList({ items }: { items: { id: string; action: string; at: Date; by: string; reason?: string | null }[] }) {
  if (items.length === 0) return <p className="text-fg-muted">Nothing recorded yet.</p>;
  return (
    <ul className="space-y-2">
      {items.map((h) => (
        <li key={h.id} className="rounded-lg bg-surface p-3 text-sm shadow-card">
          <span className="font-medium">{h.action}</span> <span className="text-fg-muted">by {h.by} on <time dateTime={h.at.toISOString()}>{h.at.toISOString().replace("T", " ").slice(0, 16)} UTC</time></span>
          {h.reason && <p className="mt-1 text-fg-muted">Reason: {h.reason}</p>}
        </li>
      ))}
    </ul>
  );
}
