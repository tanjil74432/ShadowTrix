import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { adminFallback, PageHeading } from "@/components/admin/admin-ui";
import { AdminShell } from "@/components/admin/admin-shell";
import { AnnouncementForm } from "@/components/admin/announcement-form";
import { requireUser } from "@/server/modules/auth/dal";
import { listEventChoices } from "@/server/modules/admin/announcements.service";

export const metadata: Metadata = { title: "New announcement", robots: { index: false, follow: false } };
export default function Page() {
  return (
    <Suspense fallback={adminFallback}>
      <AdminShell section="announcements" returnTo="/admin/announcements/new"><Body /></AdminShell>
    </Suspense>
  );
}

async function Body() {
  const actor = await requireUser("/admin/announcements/new");
  await connection();
  const events = await listEventChoices(actor);
  return (
    <>
      <PageHeading title="New announcement" trail={[{ label: "Announcements", href: "/admin/announcements" }, { label: "New" }]} intro="Saved as a draft. Nobody sees it until you publish it." />
      <AnnouncementForm events={events} />
    </>
  );
}
