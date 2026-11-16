import Image from "next/image";
import Link from "next/link";
import { TypewriterWord } from "@/components/home/typewriter-word";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { site } from "@/lib/site";

/**
 * One H1, one supporting sentence, exactly two actions: a primary and a secondary.
 * Sign-in is in the navigation, not here (audit: Forkship's three competing hero CTAs).
 */
const HERO_WORDS = ["Innovation", "Creativity", "Technology", "Possibilities", "The Future"] as const;

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <div aria-hidden className="bg-grid mask-fade absolute inset-0 -z-10" />
      <div aria-hidden className="absolute top-1/2 right-0 -z-10 hidden size-[42rem] -translate-y-1/2 translate-x-1/4 rounded-full bg-[radial-gradient(closest-side,rgb(240_120_50/0.12),transparent)] lg:block" />
      <Container className="grid items-center gap-12 py-16 sm:py-20 lg:grid-cols-[1.15fr_0.85fr] lg:py-28">
        <div>
          <p className="mb-5 inline-flex items-center gap-2 text-sm font-medium tracking-wide text-accent-soft uppercase animate-reveal">
            <span aria-hidden className="h-px w-8 bg-accent" />
            Events by Team EU Shadow
          </p>
          {/* One constant sentence for assistive technology and crawlers; the two visual lines below are decorative (aria-hidden) so the
              changing word is never re-announced. */}
          <h1 id="hero-title" className="text-[clamp(2.25rem,1.4rem+3.6vw,4.25rem)] leading-[1.06] font-semibold tracking-[-0.035em]">
            <span className="sr-only">{site.tagline}</span>
            <span aria-hidden className="block animate-reveal">Enter the Matrix</span>
            <span aria-hidden className="block animate-reveal [animation-delay:120ms]">
              of <TypewriterWord words={HERO_WORDS} />
            </span>
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
          <svg aria-hidden viewBox="0 0 400 400" fill="none" className="absolute inset-0 -z-10 h-full w-full">
            <circle cx="200" cy="200" r="190" stroke="rgb(255 255 255 / 0.07)" />
            <circle cx="200" cy="200" r="150" stroke="rgb(255 255 255 / 0.05)" strokeDasharray="2 8" />
            <ellipse cx="200" cy="200" rx="190" ry="70" transform="rotate(-24 200 200)" stroke="rgb(240 120 50 / 0.35)" />
            <circle cx="62" cy="270" r="4" fill="#f07832" />
            <circle cx="338" cy="128" r="3" fill="#d4d4d4" />
            <circle cx="338" cy="128" r="10" fill="#f07832" className="animate-node-pulse [transform-box:fill-box] origin-center" />
            <circle cx="120" cy="60" r="2" fill="#ff9a55" fillOpacity="0.7" />
            <circle cx="300" cy="340" r="2" fill="#f07832" fillOpacity="0.6" />
            <circle cx="40" cy="150" r="1.5" fill="#d4d4d4" fillOpacity="0.5" />
            <circle cx="360" cy="250" r="1.5" fill="#d4d4d4" fillOpacity="0.5" />
          </svg>
          <Image
            src={site.logo.src}
            alt={site.logo.alt}
            width={site.logo.width}
            height={site.logo.height}
            priority
            sizes="(min-width: 1024px) 40vw, (min-width: 640px) 28rem, 90vw"
            className="brand-logo-hero h-full w-full object-contain"
          />
        </div>
      </Container>
    </section>
  );
}
