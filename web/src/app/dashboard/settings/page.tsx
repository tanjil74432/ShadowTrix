import type { Metadata } from "next";
import { Suspense } from "react";
import { AreaNav } from "@/components/dashboard/area-nav";
import { ChangePasswordForm } from "@/components/dashboard/change-password-form";
import { ProfileForm } from "@/components/dashboard/profile-form";
import { LogoutButton } from "@/components/auth/logout-button";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/modules/auth/dal";
import { getOwnProfile } from "@/server/modules/auth/profile.service";

export const metadata: Metadata = { title: "Account settings", robots: { index: false, follow: false } };

export default function SettingsPage() {
  return (
    <Container className="py-14 sm:py-20">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <SettingsContent />
      </Suspense>
    </Container>
  );
}

async function SettingsContent() {
  const user = await requireUser("/dashboard/settings");
  const row = await getOwnProfile(user.id);
  return (
    <>
      <AreaNav user={user} current="settings" />
      <h1 className="text-h1 font-semibold">Account settings</h1>
      <div className="mt-10 grid max-w-3xl gap-12">
        <section aria-labelledby="profile-heading" className="space-y-5">
          <h2 id="profile-heading" className="text-h3 font-semibold">Profile</h2>
          <p className="text-sm text-fg-muted">Email address: <span className="font-medium text-fg break-all">{row.email}</span>. It cannot be changed here.</p>
          <ProfileForm fullName={user.fullName} bio={row.bio ?? ""} />
        </section>
        <section aria-labelledby="password-heading" className="space-y-5">
          <h2 id="password-heading" className="text-h3 font-semibold">Change password</h2>
          <p className="text-sm text-fg-muted">Changing your password signs you out of every other device.</p>
          <ChangePasswordForm />
        </section>
        <section aria-labelledby="session-heading" className="space-y-4">
          <h2 id="session-heading" className="text-h3 font-semibold">Session</h2>
          <LogoutButton />
        </section>
      </div>
    </>
  );
}
