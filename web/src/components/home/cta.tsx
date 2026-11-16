import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

export function Cta() {
  return (
    <section aria-labelledby="cta-title" className="ambient-bottom relative isolate overflow-hidden border-t border-border py-section-lg">
      <div aria-hidden className="bg-grid mask-fade absolute inset-0 -z-10" />
      <Container className="text-center">
        <h2 id="cta-title" className="mx-auto max-w-2xl text-h1 font-semibold text-balance">
          Ready to enter the matrix?
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-body-lg text-fg-muted text-pretty">
          Create an account to follow events, form a team and take part when registration opens.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/register">Join ShadowTrix</Link>
          </Button>
          <Button asChild size="lg" variant="ghost">
            <Link href="/events">Explore events</Link>
          </Button>
        </div>
      </Container>
    </section>
  );
}
