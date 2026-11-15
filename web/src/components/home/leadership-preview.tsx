import Link from "next/link";
import { ProfileCard } from "@/components/profile/profile-card";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { SampleNotice } from "@/components/ui/sample-notice";
import { SectionHeading } from "@/components/ui/section-heading";
import { placeholderLeadership, teamGroups } from "@/content/sample-data";

export function LeadershipPreview() {
  return (
    <section aria-labelledby="leadership-title" className="py-section">
      <Container>
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
        <SampleNotice className="mt-8">
          These are placeholder profiles that show the card layout. Names, photographs and terms will be added once
          verified information is provided. Positions shown are configurable examples.
        </SampleNotice>
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
          {placeholderLeadership.map((profile) => (
            <li key={profile.slug}>
              <ProfileCard profile={profile} />
            </li>
          ))}
        </ul>

        <nav aria-label="Teams" className="mt-10">
          <h3 className="text-sm font-semibold text-silver">Our teams</h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {teamGroups.map((team) => (
              <li key={team.slug}>
                <Link
                  href={`/about/team#${team.slug}`}
                  className="inline-flex h-10 items-center rounded-full border border-border-strong px-4 text-sm text-fg-muted transition-colors duration-(--duration-fast) hover:border-fg-muted hover:text-fg"
                >
                  {team.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
    </section>
  );
}
