import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { adminFallback, Chip, Facts, HistoryList, PageHeading, Section } from "@/components/admin/admin-ui";
import { AdminShell } from "@/components/admin/admin-shell";
import { AnnouncementForm } from "@/components/admin/announcement-form";
import { SchedulePublish } from "@/components/admin/schedule-publish";
import { ApiButton } from "@/components/common/api-button";
import { formatDateTime } from "@/lib/format";
import { AppError } from "@/server/http/errors";
import { requireUser } from "@/server/modules/auth/dal";
import { getAnnouncementAdmin, listEventChoices } from "@/server/modules/admin/announcements.service";

export const metadata: Metadata = { title: "Announcement", robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

export default function Page({ params }: { params: Params }) {
  return <Suspense fallback={adminFallback}><Gate params={params} /></Suspense>;
}

async function Gate({ params }: { params: Params }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  return <AdminShell section="announcements" returnTo={`/admin/announcements/${id.data}`}><Detail id={id.data} /></AdminShell>;
}

async function Detail({ id }: { id: string }) {
  const actor = await requireUser(`/admin/announcements/${id}`);
  await connection();
  const a = await getAnnouncementAdmin(actor, id).catch((err) => { if (err instanceof AppError && err.status === 404) notFound(); throw err; });
  const events = await listEventChoices(actor, a.eventId);
  const url = `/api/v1/admin/announcements/${a.id}`;
  return (
    <>
      <PageHeading title={a.title} trail={[{ label: "Announcements", href: "/admin/announcements" }, { label: a.title }]} />
      <div className="flex flex-wrap items-start gap-3" role="group" aria-label="Publication">
        <Chip tone={a.state === "PUBLISHED" ? "good" : a.state === "SCHEDULED" ? "warn" : "neutral"}>{a.state[0] + a.state.slice(1).toLowerCase()}</Chip>
        {a.state === "DRAFT" && <ApiButton url={`${url}/publish`} variant="primary" body={{}} confirm="Publish now? The audience sees it immediately.">Publish now</ApiButton>}
        {a.state !== "DRAFT" && <ApiButton url={`${url}/unpublish`} confirm="Unpublish? It is hidden from everyone and returns to draft.">Unpublish</ApiButton>}
        {a.state === "DRAFT" && <ApiButton url={url} method="DELETE" confirm="Delete this draft permanently?" doneHref="/admin/announcements">Delete draft</ApiButton>}
      </div>
      {a.state !== "PUBLISHED" && <div className="mt-4"><SchedulePublish id={a.id} /></div>}
      <Section id="facts" title="Details">
        <Facts items={[["Publishes", a.publishedAt ? formatDateTime(a.publishedAt, "UTC") : null], ["Created", `${formatDateTime(a.createdAt, "UTC")}${a.author ? ` by ${a.author.fullName}` : ""}`], ["Last edited", `${formatDateTime(a.updatedAt, "UTC")}${a.updatedBy ? ` by ${a.updatedBy.fullName}` : ""}`]]} />
      </Section>
      <Section id="edit" title="Edit"><AnnouncementForm id={a.id} events={events} values={{ title: a.title, body: a.body, audience: a.audience, eventId: a.eventId ?? "" }} /></Section>
      <Section id="hist" title="History"><HistoryList items={a.history} /></Section>
    </>
  );
}
