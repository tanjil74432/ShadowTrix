import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { AdminShell } from "@/components/admin/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/modules/auth/dal";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const fallback = <Container className="py-14"><Skeleton className="h-96 w-full" /></Container>;
import { JsonForm } from "@/components/admin/json-form";
import { QUICK_UNIVERSITIES } from "@/lib/leadership/universities";
import { listLeadershipReference, listMembers, listUniversitySuggestions } from "@/server/modules/organization/organization.service";

export const metadata: Metadata = { title: "Leadership", robots: { index: false, follow: false } };

export default function LeadershipPage({ searchParams }: { searchParams: SearchParams }) {
  return <Suspense fallback={fallback}><AdminShell section="leadership" returnTo="/admin/leadership"><Content searchParams={searchParams} /></AdminShell></Suspense>;
}

async function Content({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireUser("/admin/leadership");
  await connection();
  const sp = await searchParams;
  const parsed = z.object({ q: z.string().trim().max(100).optional(), unitId: z.uuid().optional(), status: z.enum(["ACTIVE", "FORMER"]).optional() }).safeParse({ q: first(sp.q), unitId: first(sp.unitId), status: first(sp.status) });
  const f = parsed.success ? parsed.data : {};
  const [ref, members, universities] = await Promise.all([listLeadershipReference(actor), listMembers(actor, f), listUniversitySuggestions(actor)]);
  return (
    <>
      <h1 className="text-h1 font-semibold">Leadership and teams of ShadowTrix</h1>
      <p className="mt-2 max-w-3xl text-fg-muted">
        The people who run ShadowTrix, shown on the public Our Team page. This is separate from the organizers of individual events. Nothing appears publicly until a profile is marked <strong>verified</strong> (not a placeholder) and <strong>published</strong>. No people are pre-filled.
      </p>

      <p className="mt-4"><Link href="/admin/leadership/template" className="inline-flex h-10 items-center rounded-md border border-border-strong px-4 text-sm font-medium hover:border-accent/70">Edit the Universal Matrix template</Link></p>

      <section aria-labelledby="members-heading" className="mt-10">
        <h2 id="members-heading" className="text-h3 font-semibold">Members ({members.length})</h2>
        <p className="mt-2 text-sm"><Link href="/admin/leadership/banner" className="underline underline-offset-4">Create an official banner for a verified member</Link></p>
        <form method="get" action="/admin/leadership" role="search" aria-label="Filter members" className="mt-4 grid gap-4 sm:grid-cols-[1fr_14rem_10rem_auto] sm:items-end">
          <div className="flex flex-col gap-1.5"><label htmlFor="m-q" className="text-sm font-medium">Name</label><Input id="m-q" name="q" type="search" defaultValue={"q" in f ? f.q ?? "" : ""} maxLength={100} /></div>
          <div className="flex flex-col gap-1.5"><label htmlFor="m-unit" className="text-sm font-medium">Unit</label><Select id="m-unit" name="unitId" defaultValue={"unitId" in f ? f.unitId ?? "" : ""}><option value="">Any</option>{ref.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></div>
          <div className="flex flex-col gap-1.5"><label htmlFor="m-status" className="text-sm font-medium">Status</label><Select id="m-status" name="status" defaultValue={"status" in f ? f.status ?? "" : ""}><option value="">Any</option><option value="ACTIVE">Active</option><option value="FORMER">Former</option></Select></div>
          <Button type="submit">Apply</Button>
        </form>
        {members.length === 0 ? <EmptyState className="mt-4" title="No members yet" description="Add a member with verified information. Placeholders are never shown publicly." /> : (
          <ul className="mt-4 space-y-2">
            {members.map((m) => (
              <li key={m.id} className="rounded-lg bg-surface p-4 shadow-card">
                <Link href={`/admin/leadership/members/${m.id}`} className="font-medium underline underline-offset-4">{m.fullName}</Link>{" "}
                <Badge className="text-fg">{m.visibility === "PUBLISHED" ? "Published" : "Draft"}</Badge> {m.isPlaceholder && <Badge>Placeholder</Badge>} {m.status === "FORMER" && <Badge>Former</Badge>}
                <span className="block text-sm text-fg-muted">{m.memberships.filter((x) => !x.isArchived).map((x) => `${x.designation.title}, ${x.unit.name}`).join("; ") || "No current position"}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-8 max-w-2xl"><h3 className="font-semibold">Add a member</h3>
          <div className="mt-3"><JsonForm label="Add a member" url="/api/v1/admin/members" submitLabel="Add member (unpublished placeholder)" reset successMessage="Member added as an unpublished placeholder. Open it to add details and positions." fields={[{ name: "fullName", label: "Full name", required: true }, { name: "department", label: "Department", hint: "Optional, for example CSE." }, { name: "university", label: "University", type: "combo", suggestions: universities, quick: [...QUICK_UNIVERSITIES], hint: "Optional. Type any university, or use the quick choice." }]} /></div></div>
      </section>

      <section aria-labelledby="terms-heading" className="mt-12 max-w-3xl">
        <h2 id="terms-heading" className="text-h3 font-semibold">Terms</h2>
        {ref.terms.length === 0 ? <p className="mt-3 text-fg-muted">No terms defined.</p> : <ul className="mt-4 space-y-2">{ref.terms.map((t) => <li key={t.id} className="rounded-lg bg-surface p-3 text-sm shadow-card">{t.label} <span className="text-fg-muted">{t.startsOn.toISOString().slice(0, 10)} to {t.endsOn ? t.endsOn.toISOString().slice(0, 10) : "open"}</span> {t.isCurrent && <Badge className="text-fg">Current</Badge>}</li>)}</ul>}
        <div className="mt-4 max-w-xl"><JsonForm label="Add a term" url="/api/v1/admin/leadership/terms" submitLabel="Add term" reset fields={[
          { name: "label", label: "Label", required: true, hint: "For example 2026-2027" }, { name: "startsOn", label: "Starts on", type: "date", required: true }, { name: "endsOn", label: "Ends on", type: "date" },
          { name: "isCurrent", label: "This is the current term", type: "checkbox" }]} /></div>
      </section>

      <section aria-labelledby="units-heading" className="mt-12 grid max-w-4xl gap-10 lg:grid-cols-2">
        <div><h2 id="units-heading" className="text-h3 font-semibold">Units</h2>
          <ul className="mt-4 space-y-1 text-sm">{ref.units.map((u) => <li key={u.id}>{u.name} <span className="text-fg-subtle">(order {u.displayOrder})</span></li>)}</ul>
          <div className="mt-4"><JsonForm label="Add a unit" url="/api/v1/admin/leadership/units" submitLabel="Add unit" reset fields={[{ name: "name", label: "Name", required: true }, { name: "displayOrder", label: "Display order", type: "number", defaultValue: 100 }]} /></div></div>
        <div><h2 className="text-h3 font-semibold">Designations</h2>
          <ul className="mt-4 space-y-1 text-sm">{ref.designations.map((d) => <li key={d.id}>{d.title} <span className="text-fg-subtle">(seniority {d.rankOrder})</span></li>)}</ul>
          <div className="mt-4"><JsonForm label="Add a designation" url="/api/v1/admin/leadership/designations" submitLabel="Add designation" reset fields={[{ name: "title", label: "Title", required: true }, { name: "rankOrder", label: "Seniority (lower is shown first)", type: "number", defaultValue: 1000 }]} /></div></div>
      </section>
    </>
  );
}
