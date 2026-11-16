import Link from "next/link";
import { Container } from "@/components/ui/container";
import { ArrowRightIcon } from "@/components/ui/icons";
import { SectionHeading } from "@/components/ui/section-heading";
import { EVENT_CATEGORIES, FOCUS_AREA_GROUPS, type EventCategoryKey } from "@/lib/event-categories";

const categoryKeys = Object.keys(EVENT_CATEGORIES).filter((k) => k !== "OTHER") as EventCategoryKey[];

export function Categories() {
  return (
    <section aria-labelledby="categories-title" className="ambient-left border-y border-border bg-surface py-section">
      <Container>
        <SectionHeading
          id="categories-title"
          title="Find your kind of challenge"
          description="Browse by event format, or by the technology domain you want to work in."
        />

        <h3 className="mt-12 text-h3 font-semibold">Event formats</h3>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {categoryKeys.map((key) => (
            <li key={key} className="group panel-orange rounded-lg transition-[border-color,box-shadow,transform] duration-(--duration-base) hover:-translate-y-0.5 focus-within:border-accent/70 motion-reduce:hover:translate-y-0">
              <Link href={`/events?category=${key.toLowerCase()}`} className="block h-full rounded-lg p-5">
                <span className="flex items-center justify-between gap-2 font-semibold text-accent-soft">
                  {EVENT_CATEGORIES[key].label}
                  <ArrowRightIcon className="shrink-0 text-accent transition-transform duration-(--duration-fast) group-hover:translate-x-0.5 motion-reduce:transition-none" />
                </span>
                <span aria-hidden className="mt-2 block h-0.5 w-8 rounded-full bg-gradient-to-r from-accent to-accent-soft" />
                <span className="mt-2.5 block text-sm text-silver/85 text-pretty">{EVENT_CATEGORIES[key].description}</span>
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
                      className="-mx-2 block rounded-md px-2 py-1.5 text-fg-muted transition-colors duration-(--duration-fast) hover:bg-accent-wash hover:text-accent-soft"
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
