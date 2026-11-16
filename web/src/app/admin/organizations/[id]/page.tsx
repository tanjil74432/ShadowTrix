import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { AdminShell } from "@/components/admin/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
const fallback = <Container className="py-14"><Skeleton className="h-96 w-full" /></Container>;
import { ApiButton } from "@/components/common/api-button";
import { JsonForm } from "@/components/admin/json-form";
import { getOrganization } from "@/server/modules/organization/organization.service";

export const metadata: Metadata = { title: "Organization", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;
const TYPES = [["UNIVERSITY", "University"], ["COMMUNITY", "Community"], ["COMPANY", "Company"], ["OTHER", "Other"]].map(([value, label]) => ({ value, label }));

export default function OrganizationPage({ params }: { params: Params }) {
  return <Suspense fallback={fallback}><Gate params={params} /></Suspense>;
}

async function Gate({ params }: { params: Params }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  return <AdminShell section="organizations" returnTo={`/admin/organizations/${id.data}`}><Detail id={id.data} /></AdminShell>;
}

async function Detail({ id }: { id: string }) {
  const actor = await requireUser(`/admin/organizations/${id}`);
  await connection();
  let o;
  try {
    o = await getOrganization(actor, id);
  } catch {
    notFound();
  }
  return (
    <>
      <p className="text-sm"><Link href="/admin/organizations" className="underline underline-offset-4 text-fg-muted">Organizations</Link></p>
      <h1 className="mt-4 text-h1 font-semibold text-balance">{o.name}</h1>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-fg-muted">{o.isOperator && <Badge className="text-fg">Platform operator</Badge>}{o.verifiedAt ? <>Verified {formatDateTime(o.verifiedAt, "UTC")}{o.verifiedBy ? ` by ${o.verifiedBy.fullName}` : ""}</> : "Not verified"}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <ApiButton url={`/api/v1/admin/organizations/${o.id}/verify`} body={{ verified: !o.verifiedAt }} variant="secondary">{o.verifiedAt ? "Clear verification" : "Mark as verified"}</ApiButton>
        {!o.isOperator && <ApiButton url={`/api/v1/admin/organizations/${o.id}`} method="DELETE" confirm="Delete this organization?" doneHref="/admin/organizations" variant="ghost">Delete organization</ApiButton>}
      </div>
      <section aria-labelledby="profile-heading" className="mt-10 max-w-2xl"><h2 id="profile-heading" className="text-h3 font-semibold">Profile</h2>
        <div className="mt-4"><JsonForm label="Edit organization" url={`/api/v1/admin/organizations/${o.id}`} method="PATCH" submitLabel="Save" fields={[
          { name: "name", label: "Name", required: true, defaultValue: o.name },
          ...(o.isOperator ? [] : [{ name: "type", label: "Type", type: "select" as const, options: TYPES, defaultValue: o.type }]),
          { name: "description", label: "Description", type: "textarea", defaultValue: o.description }, { name: "websiteUrl", label: "Website", type: "url", defaultValue: o.websiteUrl },
        ]} /></div></section>
      <section aria-labelledby="reps-heading" className="mt-10 max-w-2xl space-y-3"><h2 id="reps-heading" className="text-h3 font-semibold">Representatives</h2>
        {o.roles.length === 0 ? <p className="text-fg-muted">No representatives.</p> : <ul className="space-y-2">{o.roles.map((r) => (
          <li key={r.user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-3 shadow-card"><span>{r.user.fullName} <span className="text-sm text-fg-muted break-all">{r.user.email}</span></span>
            <ApiButton url={`/api/v1/admin/organizations/${o.id}/representatives/${r.user.id}`} method="DELETE" variant="ghost">Remove</ApiButton></li>))}</ul>}
        <JsonForm label="Add a representative" url={`/api/v1/admin/organizations/${o.id}/representatives`} submitLabel="Add representative" reset fields={[{ name: "email", label: "Email address of a confirmed account", type: "email", required: true }]} />
      </section>
      <section aria-labelledby="events-heading" className="mt-10"><h2 id="events-heading" className="text-h3 font-semibold">Events hosted</h2>
        {o.eventHosts.length === 0 ? <p className="mt-3 text-fg-muted">None.</p> : <ul className="mt-4 space-y-2">{o.eventHosts.map((h) => <li key={h.event.id} className="rounded-lg bg-surface p-3 text-sm shadow-card"><Link href={`/admin/events/${h.event.id}`} className="font-medium underline underline-offset-4">{h.event.title}</Link> <Badge>{h.role.replace("_", "-").toLowerCase()}</Badge> <span className="text-fg-muted">{h.event.status.toLowerCase()}</span></li>)}</ul>}
      </section>
    </>
  );
}
