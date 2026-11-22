import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { AdminShell } from "@/components/admin/admin-shell";
import { LeadershipTemplateEditor } from "@/components/admin/leadership-template-editor";
import type { CardPerson } from "@/components/leadership/leadership-card";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/modules/auth/dal";
import { getLeadershipTemplate, getMemberStyle } from "@/server/modules/organization/leadership-template.service";
import { getMember, listMembers } from "@/server/modules/organization/organization.service";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export const metadata: Metadata = { title: "Leadership template", robots: { index: false, follow: false } };

const SAMPLE: CardPerson = {
  id: "sample", name: "Aarav Rahman", designation: "President", unitName: "Leadership Board", term: "2026-2027", department: "CSE", university: "Eastern University",
  bio: "Builds communities that ship ideas.", skills: ["Leadership", "Python"], links: {}, photoSrc: null,
};

export default function LeadershipTemplatePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<Container className="py-14"><Skeleton className="h-96 w-full" /></Container>}>
      <AdminShell section="leadership" returnTo="/admin/leadership/template"><Content searchParams={searchParams} /></AdminShell>
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireUser("/admin/leadership/template");
  await connection();
  const sp = await searchParams;
  const id = z.uuid().safeParse(Array.isArray(sp.member) ? sp.member[0] : sp.member);
  const [template, members] = await Promise.all([getLeadershipTemplate(), listMembers(actor, {})]);
  let person = SAMPLE;
  let memberStyle = null;
  if (id.success) {
    const m = await getMember(actor, id.data).catch(() => null);
    if (m) {
      memberStyle = await getMemberStyle(m.id); // the member as published: their own portrait position and decorative text
      const current = m.memberships.find((x) => !x.isArchived) ?? m.memberships[0];
      person = {
        id: m.id, name: m.fullName, designation: current?.designation.title ?? "Designation", unitName: current?.unit.name ?? null, term: current?.term?.label ?? null,
        department: m.department, university: m.university, bio: m.bio, skills: m.skills, links: { linkedin: m.linkedinUrl, github: m.githubUrl, portfolio: m.portfolioUrl }, email: m.emailPublic ? m.email : null,
        photoSrc: m.photoUrl ? `/api/v1/org-members/${m.id}/photo` : null,
      };
    }
  }
  return (
    <>
      <p className="text-sm"><Link href="/admin/leadership" className="underline underline-offset-4 text-fg-muted">Leadership</Link></p>
      <h1 className="mt-4 text-h1 font-semibold">Universal Matrix leadership template</h1>
      <p className="mt-2 max-w-3xl text-fg-muted">
        One design for every board member: a ShadowTrix Matrix background, large decorative text behind the portrait and an information board. Each member keeps their own portrait and details;
        change a member&apos;s portrait position and decorative text on their own page. Saving here updates the homepage and the Leadership Board for every published member.
      </p>
      <div className="mt-8">
        <LeadershipTemplateEditor initial={template} person={person} members={members.slice(0, 100).map((m) => ({ id: m.id, name: m.fullName }))} selectedMemberId={id.success ? id.data : ""} memberStyle={memberStyle} />
      </div>
    </>
  );
}
