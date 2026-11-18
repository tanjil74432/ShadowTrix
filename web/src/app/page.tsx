import { Suspense } from "react";
import { AboutOrg } from "@/components/home/about-org";
import { Categories } from "@/components/home/categories";
import { Community } from "@/components/home/community";
import { Cta } from "@/components/home/cta";
import { FeaturedEvents } from "@/components/home/featured-events";
import { Hero } from "@/components/home/hero";
import { HowItWorks } from "@/components/home/how-it-works";
import { LeadershipPreview } from "@/components/home/leadership-preview";
import { PreviousEvents } from "@/components/home/previous-events";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { site } from "@/lib/site";

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: site.name,
  url: site.url,
  logo: `${site.url}${site.logo.src}`,
  description: site.description,
  parentOrganization: { "@type": "Organization", name: site.operator },
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static, trusted object: no user input. "<" is escaped as a defensive habit.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd).replace(/</g, "\\u003c") }}
      />
      <Hero />
      <FeaturedEvents />
      <Categories />
      <HowItWorks />
      <AboutOrg />
      <Suspense fallback={<section aria-label="Leadership" className="py-section"><Container><Skeleton className="h-96 w-full" /></Container></section>}>
        <LeadershipPreview />
      </Suspense>
      <Community />
      <PreviousEvents />
      <Cta />
    </>
  );
}
