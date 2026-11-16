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
import { requireUser } from "@/server/modules/auth/dal";
const fallback = <Container className="py-14"><Skeleton className="h-96 w-full" /></Container>;
import Image from "next/image";
import { ApiButton } from "@/components/common/api-button";
import { JsonForm } from "@/components/admin/json-form";
import { PhotoUploader } from "@/components/admin/photo-uploader";
import { getMember, listLeadershipReference } from "@/server/modules/organization/organization.service";

export const metadata: Metadata = { title: "Member", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

export default function MemberPage({ params }: { params: Params }) {
  return <Suspense fallback={fallback}><Gate params={params} /></Suspense>;
}

async function Gate({ params }: { params: Params }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  return <AdminShell section="leadership" returnTo={`/admin/leadership/members/${id.data}`}><Detail id={id.data} /></AdminShell>;
}

async function Detail({ id }: { id: string }) {
  const actor = await requireUser(`/admin/leadership/members/${id}`);
  await connection();
  let m, ref;
  try {
    [m, ref] = await Promise.all([getMember(actor, id), listLeadershipReference(actor)]);
  } catch {
    notFound();
  }
  const opt = (rows: { id: string; label: string }[], empty = "None") => [{ value: "", label: empty }, ...rows.map((r) => ({ value: r.id, label: r.label }))];
  return (
    <>
      <p className="text-sm"><Link href="/admin/leadership" className="underline underline-offset-4 text-fg-muted">Leadership</Link></p>
      <div className="mt-4 flex flex-wrap items-center gap-3"><h1 className="text-h1 font-semibold text-balance">{m.fullName}</h1>
        <Badge className="text-fg">{m.visibility === "PUBLISHED" ? "Published" : "Draft"}</Badge>{m.isPlaceholder && <Badge>Placeholder</Badge>}{m.status === "FORMER" && <Badge>Former</Badge>}</div>
      <p className="mt-2 max-w-2xl text-fg-muted">A profile is shown publicly only when it is <strong>verified</strong> (not a placeholder) and <strong>published</strong>. The email appears only if you tick the public contact box.</p>

      <section aria-labelledby="photo-heading" className="mt-10 max-w-xl space-y-3"><h2 id="photo-heading" className="text-h3 font-semibold">Photo</h2>
        {m.photoUrl && <Image src={m.photoUrl} alt={`Photo of ${m.fullName}`} width={160} height={160} unoptimized className="size-40 rounded-lg object-cover" />}
        <PhotoUploader memberId={m.id} hasPhoto={!!m.photoUrl} /></section>

      <section aria-labelledby="profile-heading" className="mt-10 max-w-2xl"><h2 id="profile-heading" className="text-h3 font-semibold">Profile</h2>
        <div className="mt-4"><JsonForm label="Edit member" url={`/api/v1/admin/members/${m.id}`} method="PATCH" submitLabel="Save profile" fields={[
          { name: "fullName", label: "Full name", required: true, defaultValue: m.fullName }, { name: "bio", label: "Bio", type: "textarea", defaultValue: m.bio },
          { name: "department", label: "Department", defaultValue: m.department }, { name: "responsibilities", label: "Responsibilities", type: "textarea", defaultValue: m.responsibilities },
          { name: "skills", label: "Skills", type: "list", hint: "Separate with commas.", defaultValue: m.skills.join(", ") },
          { name: "linkedinUrl", label: "LinkedIn", type: "url", defaultValue: m.linkedinUrl }, { name: "githubUrl", label: "GitHub", type: "url", defaultValue: m.githubUrl }, { name: "portfolioUrl", label: "Portfolio", type: "url", defaultValue: m.portfolioUrl },
          { name: "email", label: "Contact email", type: "email", defaultValue: m.email },
          { name: "emailPublic", label: "Show the contact email publicly", type: "checkbox", defaultValue: m.emailPublic },
          { name: "status", label: "Status", type: "select", options: [{ value: "ACTIVE", label: "Active" }, { value: "FORMER", label: "Former member" }], defaultValue: m.status },
          { name: "isPlaceholder", label: "Placeholder (details not yet verified)", type: "checkbox", hint: "Untick only when the information was verified with the person.", defaultValue: m.isPlaceholder },
          { name: "visibility", label: "Visibility", type: "select", options: [{ value: "DRAFT", label: "Draft (not public)" }, { value: "PUBLISHED", label: "Published" }], defaultValue: m.visibility },
        ]} /></div></section>

      <section aria-labelledby="positions-heading" className="mt-10 max-w-3xl space-y-3"><h2 id="positions-heading" className="text-h3 font-semibold">Positions</h2>
        {m.memberships.length === 0 ? <p className="text-fg-muted">No positions yet.</p> : <ul className="space-y-2">{m.memberships.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-3 shadow-card">
            <span>{p.designation.title}, {p.unit.name} <span className="text-sm text-fg-muted">{p.term?.label ?? "no term"}, order {p.displayOrder}{p.startedOn ? `, from ${p.startedOn.toISOString().slice(0, 10)}` : ""}{p.endedOn ? ` to ${p.endedOn.toISOString().slice(0, 10)}` : ""}</span> {p.isArchived && <Badge>Archived</Badge>}</span>
            <span className="flex gap-2">{!p.isArchived && <ApiButton url={`/api/v1/admin/memberships/${p.id}`} method="PATCH" body={{ isArchived: true }} variant="ghost" confirm="Archive this position? It leaves the current team listing and keeps the history.">Archive</ApiButton>}
              <ApiButton url={`/api/v1/admin/memberships/${p.id}`} method="DELETE" variant="ghost" confirm="Delete this position record?">Delete</ApiButton></span></li>))}</ul>}
        <JsonForm label="Add a position" url={`/api/v1/admin/members/${m.id}/memberships`} submitLabel="Add position" reset fields={[
          { name: "unitId", label: "Unit", type: "select", required: true, options: ref.units.map((u) => ({ value: u.id, label: u.name })) },
          { name: "designationId", label: "Designation", type: "select", required: true, options: ref.designations.map((d) => ({ value: d.id, label: d.title })) },
          { name: "termId", label: "Term", type: "select", options: opt(ref.terms.map((t) => ({ id: t.id, label: t.label })), "No term") },
          { name: "startedOn", label: "Started on", type: "date" }, { name: "endedOn", label: "Ended on", type: "date" }, { name: "displayOrder", label: "Display order within the unit", type: "number", defaultValue: 0 },
        ]} />
      </section>

      <section aria-labelledby="delete-heading" className="mt-12"><h2 id="delete-heading" className="text-h3 font-semibold">Delete</h2>
        <p className="mt-2 text-fg-muted">Removes the profile, its positions and its photo permanently. To keep the history, mark the person as a former member and archive positions instead.</p>
        <div className="mt-3"><ApiButton url={`/api/v1/admin/members/${m.id}`} method="DELETE" confirm="Delete this member permanently?" doneHref="/admin/leadership">Delete member</ApiButton></div></section>
    </>
  );
}
