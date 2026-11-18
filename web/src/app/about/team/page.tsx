import type { Metadata } from "next";
import Image from "next/image";
import { connection } from "next/server";
import { Suspense } from "react";
import { toCardPerson } from "@/components/leadership/card-person";
import { LeadershipCard } from "@/components/leadership/leadership-card";
import { ScrollToHash } from "@/components/layout/scroll-to-hash";
import { ComingSoon } from "@/components/layout/coming-soon";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { getPublicTeam } from "@/server/modules/organization/organization.service";

export const metadata: Metadata = {
  title: "Our Team",
  description: "The people who run ShadowTrix.",
};

type Team = Awaited<ReturnType<typeof getPublicTeam>>;

export default function TeamPage() {
  return (
    <Suspense fallback={<Container className="py-14"><Skeleton className="h-96 w-full" /></Container>}>
      <TeamContent />
    </Suspense>
  );
}

async function TeamContent() {
  await connection();
  const team = await getPublicTeam();
  // Nothing is invented: until an administrator has published verified profiles, the page says so.
  if (team.units.length === 0 && team.former.length === 0) {
    return (
      <>
        <meta name="robots" content="noindex" />
        <ComingSoon title="The team page is coming soon" description="The leadership board and working teams will be listed here once their details have been verified." />
      </>
    );
  }
  return (
    <Container className="py-14 sm:py-20">
      <h1 className="text-h1 font-semibold text-balance">Our Team</h1>
      <p className="mt-3 max-w-2xl text-fg-muted text-pretty">The people who run ShadowTrix. The organizers of each event are listed on the event itself.</p>
      <ScrollToHash />
      {team.units.map((u) => (
        <section key={u.id} id={u.slug} aria-labelledby={`unit-${u.id}`} className="mt-12 scroll-mt-24" data-testid="team-unit">
          <h2 id={`unit-${u.id}`} className="text-h2 font-semibold">{u.name}</h2>
          <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {u.people.map((p, i) => <li key={p.id}><LeadershipCard person={toCardPerson(p, u.name)} template={team.template} style={p.style} eager={i < 3} /></li>)}
          </ul>
        </section>
      ))}
      {team.former.length > 0 && (
        <section aria-labelledby="former-heading" className="mt-16">
          <h2 id="former-heading" className="text-h2 font-semibold">Former members</h2>
          <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{team.former.map((p) => <Person key={`f-${p.id}-${p.designation}`} p={p} />)}</ul>
        </section>
      )}
    </Container>
  );
}

function Person({ p }: { p: Team["units"][number]["people"][number] }) {
  return (
    <li className="panel-orange space-y-3 rounded-lg p-5">
      {p.hasPhoto && <Image src={`/api/v1/org-members/${p.id}/photo`} alt={`Photo of ${p.name}`} width={96} height={96} unoptimized className="size-24 rounded-lg object-cover" />}
      <div>
        <h3 className="text-h3 font-semibold">{p.name}</h3>
        <p className="font-medium text-accent-soft">{p.designation}{p.term ? `, ${p.term}` : ""}</p>
        {p.department && <p className="text-sm text-fg-muted">{p.department}</p>}
      </div>
      {p.bio && <p className="text-sm text-fg-muted text-pretty">{p.bio}</p>}
      {p.skills.length > 0 && <p className="text-sm text-fg-muted">{p.skills.join(", ")}</p>}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {p.links.linkedin && <a href={p.links.linkedin} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-4">LinkedIn</a>}
        {p.links.github && <a href={p.links.github} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-4">GitHub</a>}
        {p.links.portfolio && <a href={p.links.portfolio} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-4">Portfolio</a>}
        {p.email && <a href={`mailto:${p.email}`} className="underline underline-offset-4">{p.email}</a>}
      </p>
    </li>
  );
}
