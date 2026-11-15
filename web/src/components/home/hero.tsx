import Image from "next/image";
import Link from "next/link";
import { AnimatedHeadline } from "@/components/ui/animated-headline";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { site } from "@/lib/site";

/**
 * One H1, one supporting sentence, exactly two actions: a primary and a secondary.
 * Sign-in is in the navigation, not here (audit: Forkship's three competing hero CTAs).
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <div aria-hidden className="bg-grid mask-fade absolute inset-0 -z-10" />
      <Container className="grid items-center gap-12 py-16 sm:py-20 lg:grid-cols-[1.15fr_0.85fr] lg:py-28">
        <div>
          <h1 id="hero-title" className="text-display font-semibold text-balance">
            <AnimatedHeadline text={site.tagline} />
          </h1>
          <p className="mt-6 max-w-xl text-body-lg text-fg-muted text-pretty animate-reveal [animation-delay:450ms]">
            Discover competitions, connect with innovators, and turn your ideas into reality.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row animate-reveal [animation-delay:600ms]">
            <Button asChild size="lg">
              <Link href="/events">Explore Events</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/register">Join ShadowTrix</Link>
            </Button>
          </div>
        </div>

        <div className="relative mx-auto aspect-square w-full max-w-sm sm:max-w-md lg:max-w-none">
          <Image
            src={site.logo.src}
            alt={site.logo.alt}
            width={site.logo.width}
            height={site.logo.height}
            priority
            sizes="(min-width: 1024px) 40vw, (min-width: 640px) 28rem, 90vw"
            className="h-full w-full object-contain"
          />
        </div>
      </Container>
    </section>
  );
}
