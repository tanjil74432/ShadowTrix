import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EVENT_CATEGORIES } from "@/lib/event-categories";

/**
 * Search and category filter. A plain GET form, so it works without JavaScript and every result page has a
 * shareable URL.
 */
export function EventFilters({ q, category }: { q?: string; category?: string }) {
  return (
    <form method="get" action="/events" role="search" aria-label="Search events" className="grid gap-4 sm:grid-cols-[1fr_16rem_auto] sm:items-end">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="event-q" className="text-sm font-medium">
          Search
        </label>
        <Input id="event-q" name="q" type="search" defaultValue={q ?? ""} maxLength={100} placeholder="Title or keyword" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="event-category" className="text-sm font-medium">
          Category
        </label>
        <Select id="event-category" name="category" defaultValue={category ?? ""}>
          <option value="">All categories</option>
          {Object.entries(EVENT_CATEGORIES).map(([key, c]) => (
            <option key={key} value={key}>
              {c.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex gap-2">
        <Button type="submit">Apply</Button>
        {(q || category) && (
          <Button asChild variant="ghost">
            <Link href="/events">Clear</Link>
          </Button>
        )}
      </div>
    </form>
  );
}
