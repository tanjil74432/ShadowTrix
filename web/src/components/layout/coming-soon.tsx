import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

/**
 * Honest placeholder for routes that are linked from the navigation but not built yet.
 * Avoids broken links (404s) without pretending the feature exists. Pages using it are noindex.
 */
export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <section aria-labelledby="page-title" className="relative isolate overflow-hidden">
      <div aria-hidden className="bg-grid mask-fade absolute inset-0 -z-10" />
      <Container className="py-24 sm:py-32">
        <p className="text-sm font-medium text-fg-muted">Not available yet</p>
        <h1 id="page-title" className="mt-3 max-w-2xl text-h1 font-semibold text-balance">
          {title}
        </h1>
        <p className="mt-5 max-w-xl text-body-lg text-fg-muted text-pretty">{description}</p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/">Back to home</Link>
          </Button>
        </div>
      </Container>
    </section>
  );
}
