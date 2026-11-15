import Link from "next/link";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { EVENT_CATEGORIES, FOCUS_AREA_GROUPS, type EventCategoryKey } from "@/lib/event-categories";

const categoryKeys = Object.keys(EVENT_CATEGORIES).filter((k) => k !== "OTHER") as EventCategoryKey[];

export function Categories() {
  return (
    <section aria-labelledby="categories-title" className="border-y border-border bg-surface py-section">
      <Container>
        <SectionHeading
          id="categories-title"
          title="Find your kind of challenge"
          description="Browse by event format, or by the technology domain you want to work in."
        />

        <h3 className="mt-12 text-h3 font-semibold">Event formats</h3>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {categoryKeys.map((key) => (
            <li key={key} className="rounded-lg bg-surface-raised shadow-card transition-shadow duration-(--duration-base) hover:shadow-card-hover focus-within:shadow-card-hover">
              <Link
                href={`/events?category=${key.toLowerCase()}`}
                className="group block h-full rounded-lg p-5"
              >
                <span className="font-medium">{EVENT_CATEGORIES[key].label}</span>
                <span className="mt-1.5 block text-sm text-fg-muted text-pretty">{EVENT_CATEGORIES[key].description}</span>
              </Link>
            </li>
          ))}
        </ul>

        <h3 className="mt-14 text-h3 font-semibold">Technology domains</h3>
        <div className="mt-5 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {FOCUS_AREA_GROUPS.map((group) => (
            <div key={group.title}>
              <h4 className="text-sm font-semibold text-silver">{group.title}</h4>
              <ul className="mt-3 space-y-1">
                {group.areas.map((area) => (
                  <li key={area.slug}>
                    <Link
                      href={`/events?focus=${area.slug}`}
                      className="-mx-2 block rounded-md px-2 py-1.5 text-fg-muted transition-colors duration-(--duration-fast) hover:bg-surface-raised hover:text-fg"
                    >
                      {area.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
