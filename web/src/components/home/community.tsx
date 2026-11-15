import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";

const roles = [
  { title: "Participants", body: "Compete solo or in a team, learn from other builders and keep a record of your work." },
  { title: "Mentors and judges", body: "Share your experience by guiding teams and evaluating projects fairly." },
  { title: "Organizers", body: "Run events with tools for registration, announcements, submissions and results." },
  { title: "Partners", body: "Universities and communities that want to host or support events." },
];

export function Community() {
  return (
    <section aria-labelledby="community-title" className="border-y border-border bg-surface py-section">
      <Container>
        <SectionHeading
          id="community-title"
          title="A community of builders"
          description="Whether you compete, judge, mentor or organize, there is a place for you."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/community">Visit the community</Link>
            </Button>
          }
        />
        <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {roles.map((r) => (
            <li key={r.title} className="rounded-lg bg-surface-raised p-6 shadow-card">
              <h3 className="text-h3 font-semibold">{r.title}</h3>
              <p className="mt-2 text-fg-muted text-pretty">{r.body}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
