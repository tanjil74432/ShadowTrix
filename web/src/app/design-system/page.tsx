import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { EventCard } from "@/components/event/event-card";
import { EventTimeline } from "@/components/event/event-timeline";
import { ProfileCard } from "@/components/profile/profile-card";
import { Badge, CategoryBadge, PlaceholderBadge, SampleBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EventCardSkeleton, Spinner } from "@/components/ui/skeleton";
import { SectionHeading } from "@/components/ui/section-heading";
import { StatusBadge } from "@/components/ui/status-badge";
import { placeholderLeadership, sampleUpcomingEvents } from "@/content/sample-data";
import { EVENT_CATEGORIES, type EventCategoryKey } from "@/lib/event-categories";
import { STATUS_LABEL } from "@/lib/event-status";
import type { RegistrationStatus } from "@/types/event";

export const metadata: Metadata = {
  title: "Design system",
  robots: { index: false, follow: false },
};

const colors = ["bg", "surface", "surface-raised", "border", "border-strong", "field-border", "fg", "fg-muted", "fg-subtle", "silver", "accent", "danger"];
const typeScale = [
  ["text-display", "Display"],
  ["text-h1", "Heading 1"],
  ["text-h2", "Heading 2"],
  ["text-h3", "Heading 3"],
  ["text-body-lg", "Body large"],
  ["text-base", "Body"],
  ["text-sm", "Small"],
  ["text-xs", "Caption"],
] as const;

export default function DesignSystemPage() {
  // Internal reference. Decided per request (not baked in at build time) and hidden unless enabled.
  return (
    <Suspense fallback={null}>
      <Guarded />
    </Suspense>
  );
}

async function Guarded() {
  await connection();
  if (process.env.ENABLE_STYLEGUIDE !== "true") notFound();
  return <Content />;
}

function Block({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-border py-12">
      <h2 id={id} className="text-h2 font-semibold">
        {title}
      </h2>
      <div className="mt-8">{children}</div>
    </section>
  );
}

function Content() {
  const statuses = Object.keys(STATUS_LABEL) as RegistrationStatus[];
  const categories = Object.keys(EVENT_CATEGORIES) as EventCategoryKey[];
  return (
    <Container className="py-14">
      <SectionHeading
        as="h1"
        title="ShadowTrix design system"
        description="Live reference for tokens and components. Values live in globals.css; contrast is verified by tests."
      />

      <Block id="ds-color" title="Color">
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {colors.map((c) => (
            <li key={c}>
              <div className="h-16 rounded-md border border-border-strong" style={{ background: `var(--color-${c})` }} />
              <p className="mt-2 font-mono text-sm">{c}</p>
            </li>
          ))}
        </ul>
      </Block>

      <Block id="ds-type" title="Typography">
        <div className="space-y-5">
          {typeScale.map(([cls, label]) => (
            <p key={cls} className={`${cls} font-semibold`}>
              {label} <span className="font-mono text-sm font-normal text-fg-subtle">{cls}</span>
            </p>
          ))}
        </div>
      </Block>

      <Block id="ds-buttons" title="Buttons">
        <div className="flex flex-wrap items-center gap-4">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
        </div>
      </Block>

      <Block id="ds-badges" title="Badges and status">
        <div className="flex flex-wrap gap-3">
          {categories.map((c) => (
            <CategoryBadge key={c} category={c} />
          ))}
          <Badge>Neutral</Badge>
          <SampleBadge />
          <PlaceholderBadge />
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          {statuses.map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
      </Block>

      <Block id="ds-forms" title="Form elements">
        <form className="grid max-w-xl gap-5" onSubmit={undefined} aria-label="Form element examples">
          <Field label="Full name" required hint="As you would like it to appear on certificates.">
            {(p) => <Input {...p} placeholder="Your name" autoComplete="name" />}
          </Field>
          <Field label="Email" required error="Enter an email address in the format name@example.com.">
            {(p) => <Input {...p} type="email" defaultValue="not-an-email" autoComplete="email" />}
          </Field>
          <Field label="Event format">
            {(p) => (
              <Select {...p} defaultValue="">
                <option value="" disabled>
                  Choose a format
                </option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {EVENT_CATEGORIES[c].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Message" hint="Up to 1000 characters.">
            {(p) => <Textarea {...p} />}
          </Field>
        </form>
      </Block>

      <Block id="ds-states" title="Loading and empty states">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <Spinner />
            <EventCardSkeleton />
          </div>
          <EmptyState
            title="No events yet"
            description="Published events will appear here. Check back soon."
            action={<Button variant="secondary">Back to home</Button>}
          />
        </div>
      </Block>

      <Block id="ds-cards" title="Event card">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {sampleUpcomingEvents.map((e) => (
            <EventCard key={e.slug} event={e} headingLevel="h3" />
          ))}
          <EventCard
            event={{ ...sampleUpcomingEvents[0], slug: "sample-linked", title: "Card with a details link", href: "/events", status: "FULL" }}
          />
        </div>
      </Block>

      <Block id="ds-profiles" title="Profile card">
        <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
          {placeholderLeadership.map((p) => (
            <ProfileCard key={p.slug} profile={p} />
          ))}
        </div>
      </Block>

      <Block id="ds-timeline" title="Event timeline">
        <div className="max-w-lg">
          <EventTimeline timeline={sampleUpcomingEvents[0].timeline} timezone="UTC" />
        </div>
      </Block>
    </Container>
  );
}
