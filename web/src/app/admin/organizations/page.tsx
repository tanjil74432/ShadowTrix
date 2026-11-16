import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/modules/auth/dal";
const fallback = <Container className="py-14"><Skeleton className="h-96 w-full" /></Container>;
import { JsonForm } from "@/components/admin/json-form";
import { listOrganizations } from "@/server/modules/organization/organization.service";

export const metadata: Metadata = { title: "Organizations", robots: { index: false, follow: false } };

const TYPES = [["UNIVERSITY", "University"], ["COMMUNITY", "Community"], ["COMPANY", "Company"], ["OTHER", "Other"]].map(([value, label]) => ({ value, label }));

export default function OrganizationsPage() {
  return <Suspense fallback={fallback}><AdminShell section="organizations" returnTo="/admin/organizations"><List /></AdminShell></Suspense>;
}

async function List() {
  const actor = await requireUser("/admin/organizations");
  await connection();
  const orgs = await listOrganizations(actor);
  return (
    <>
      <h1 className="text-h1 font-semibold">Organizations</h1>
      <p className="mt-2 max-w-3xl text-fg-muted">Organizations that host or support events. The platform operator organization is fixed. This is not a multi-tenant feature: it only records who hosts an event.</p>
      <ul className="mt-8 space-y-3">
        {orgs.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-4 shadow-card">
            <span><Link href={`/admin/organizations/${o.id}`} className="font-medium underline underline-offset-4">{o.name}</Link> {o.isOperator && <Badge className="text-fg">Platform operator</Badge>} {o.verifiedAt ? <Badge className="text-fg">Verified</Badge> : <Badge>Not verified</Badge>}
              <span className="block text-sm text-fg-muted">{o.type.toLowerCase().replace("_", " ")} - hosts {o._count.eventHosts} {o._count.eventHosts === 1 ? "event" : "events"}</span></span>
          </li>
        ))}
      </ul>
      <section aria-labelledby="new-org" className="mt-12 max-w-2xl"><h2 id="new-org" className="text-h3 font-semibold">Add an organization</h2>
        <div className="mt-4"><JsonForm label="Add an organization" url="/api/v1/admin/organizations" submitLabel="Add organization" reset fields={[
          { name: "name", label: "Name", required: true }, { name: "type", label: "Type", type: "select", options: TYPES, defaultValue: "OTHER" },
          { name: "description", label: "Description", type: "textarea" }, { name: "websiteUrl", label: "Website", type: "url", hint: "Starting with https://" },
        ]} /></div></section>
    </>
  );
}
