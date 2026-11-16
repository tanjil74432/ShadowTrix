import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { site } from "@/lib/site";

const pillars = [
  { title: "Learn", body: "Workshops and challenges that build practical skills." },
  { title: "Build", body: "Real projects, shipped against real deadlines." },
  { title: "Collaborate", body: "Teams formed around ideas, not just friend groups." },
  { title: "Share", body: "Public results, certificates and a record of what you made." },
];

export function AboutOrg() {
  return (
    <section aria-labelledby="about-title" className="ambient-right border-y border-border bg-surface py-section">
      <Container className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
        <div>
          <SectionHeading
            id="about-title"
            title={`Built and operated by ${site.operator}`}
            description="ShadowTrix brings event discovery, registration, team formation, submissions, judging and certificates into one platform, so organizers can focus on the event and participants on the work."
          />
          <p className="mt-5 text-fg-muted text-pretty">
            The platform is designed so partner universities and communities can host or co-host events in the future.
          </p>
        </div>
        <dl className="grid gap-px overflow-hidden rounded-lg bg-accent/20 sm:grid-cols-2">
          {pillars.map((p) => (
            <div key={p.title} className="bg-surface-raised bg-[linear-gradient(155deg,rgb(240_120_50/0.1),transparent_55%)] p-6">
              <dt className="text-h3 font-semibold">{p.title}</dt>
              <dd className="mt-2 text-fg-muted text-pretty">{p.body}</dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}
