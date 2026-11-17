import type { Metadata } from "next";
import { Suspense } from "react";
import { AreaNav } from "@/components/dashboard/area-nav";
import { BannerCreator } from "@/components/banner/banner-creator";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/modules/auth/dal";
import { availableTemplates } from "@/server/modules/banner/template-access";
import { getOwnBannerSubject } from "@/server/modules/organization/banner.service";

export const metadata: Metadata = { title: "Banner creator", robots: { index: false, follow: false } };

export default function BannerPage() {
  return (
    <Container className="banner-page py-14 sm:py-20" data-banner-fit>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <BannerContent />
      </Suspense>
    </Container>
  );
}

async function BannerContent() {
  const user = await requireUser("/dashboard/banner");
  const subject = await getOwnBannerSubject(user);
  return (
    <>
      <AreaNav user={user} current="banner" />
      <h1 className="banner-title text-h1 font-semibold">Your ShadowTrix banner</h1>
      <p className="banner-intro mt-2 mb-8 max-w-2xl text-fg-muted">
        Create the official ShadowTrix banner for sharing, for example on Facebook. Everything happens in your browser, so your photo is never uploaded.
      </p>
      <BannerCreator fit templates={availableTemplates(user)} subject={{ fullName: subject.fullName, designations: subject.designations }} />
    </>
  );
}
