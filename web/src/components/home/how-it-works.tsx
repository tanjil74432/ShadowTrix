import { EventTimeline } from "@/components/event/event-timeline";
import { Container } from "@/components/ui/container";
import { SampleNotice } from "@/components/ui/sample-notice";
import { SectionHeading } from "@/components/ui/section-heading";
import { sampleUpcomingEvents } from "@/content/sample-data";

const steps = [
  { title: "Discover", body: "Browse upcoming events and filter by format or technology domain to find the right fit." },
  { title: "Team up", body: "Register on your own, or create a team and invite the people you want to build with." },
  { title: "Build and submit", body: "Work on your project, then submit a description, repository and demo before the deadline." },
  { title: "Get recognized", body: "Judges score each submission against the event's criteria. Results and certificates follow." },
];

export function HowItWorks() {
  const example = sampleUpcomingEvents[0];
  return (
    <section aria-labelledby="how-title" className="py-section">
      <Container>
        <SectionHeading
          id="how-title"
          title="How ShadowTrix works"
          description="From finding an event to receiving a certificate, every step happens in one place."
        />
        <div className="mt-12 grid gap-12 lg:grid-cols-2 lg:gap-16">
          <ol className="space-y-8">
            {steps.map((step, i) => (
              <li key={step.title} className="flex gap-5">
                <span
                  aria-hidden
                  className="grid size-10 shrink-0 place-items-center rounded-full border border-border-strong font-mono text-sm text-silver"
                >
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-h3 font-semibold">{step.title}</h3>
                  <p className="mt-1.5 text-fg-muted text-pretty">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="rounded-lg bg-surface p-6 shadow-card sm:p-8">
            <h3 className="text-h3 font-semibold">Every date, spelled out</h3>
            <p className="mt-2 text-fg-muted text-pretty">
              Registration, the event itself, the submission deadline, judging and results are always shown as separate phases.
            </p>
            <SampleNotice className="mt-5">Example timeline for a demonstration event.</SampleNotice>
            <EventTimeline timeline={example.timeline} timezone={example.timezone} className="mt-8" />
          </div>
        </div>
      </Container>
    </section>
  );
}
