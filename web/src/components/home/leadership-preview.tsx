import Link from "next/link";
import { connection } from "next/server";
import { toCardPerson } from "@/components/leadership/card-person";
import { LeadershipCard } from "@/components/leadership/leadership-card";
import { ProfileCard } from "@/components/profile/profile-card";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { SampleNotice } from "@/components/ui/sample-notice";
import { SectionHeading } from "@/components/ui/section-heading";
import { placeholderLeadership, teamGroups } from "@/content/sample-data";
import { getPublicTeam } from "@/server/modules/organization/organization.service";

const HOME_LIMIT = 12;

const heading = (
  <SectionHeading
    id="leadership-title"
    title="Meet the people behind ShadowTrix"
    description="Leadership and the working teams that run events, build the platform and support the community."
    action={
      <Button asChild variant="secondary" size="sm">
        <Link href="/about/team">Meet Our Team</Link>
      </Button>
    }
  />
);

const chip = "inline-flex h-10 items-center rounded-full border border-border-strong px-4 text-sm text-fg-muted transition-colors duration-(--duration-fast) hover:border-accent/70 hover:text-fg";

/**
 * The homepage leadership section. It shows the REAL published leadership, rendered with the same Universal Matrix Leadership Template as the
 * Leadership Board page (`getPublicTeam()`: verified and published members of active units only; drafts and placeholders never appear).
 * Only when no member is eligible does it fall back to the placeholder profiles that show the card layout.
 */
export async function LeadershipPreview() {
  await connection();
  const team = await getPublicTeam();
  const people = team.units.flatMap((u) => u.people.map((p) => ({ unit: u.name, p })));

  if (people.length === 0) {
    return (
      <section aria-labelledby="leadership-title" className="py-section">
        <Container>
          {heading}
          <SampleNotice className="mt-8">
            These are placeholder profiles that show the card layout. Names, photographs and terms will be added once
            verified information is provided. Positions shown are configurable examples.
          </SampleNotice>
          <ul className="mt-6 grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
            {placeholderLeadership.map((profile) => (
              <li key={profile.slug}><ProfileCard profile={profile} /></li>
            ))}
          </ul>
          <nav aria-label="Teams" className="mt-10">
            <h3 className="text-sm font-semibold text-silver">Our teams</h3>
            <ul className="mt-3 flex flex-wrap gap-2">
              {teamGroups.map((t) => <li key={t.slug}><Link href={`/about/team#${t.slug}`} className={chip}>{t.name}</Link></li>)}
            </ul>
          </nav>
        </Container>
      </section>
    );
  }

  return (
    <section aria-labelledby="leadership-title" className="py-section" data-testid="home-leadership">
      <Container>
        {heading}
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {people.slice(0, HOME_LIMIT).map(({ unit, p }, i) => (
            <li key={p.id}><LeadershipCard person={toCardPerson(p, unit)} template={team.template} style={p.style} eager={i < 4} /></li>
          ))}
        </ul>
        <nav aria-label="Teams" className="mt-10">
          <h3 className="text-sm font-semibold text-silver">Our teams</h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {team.units.map((u) => <li key={u.id}><Link href={`/about/team#${u.slug}`} className={chip}>{u.name}</Link></li>)}
          </ul>
        </nav>
      </Container>
    </section>
  );
}
