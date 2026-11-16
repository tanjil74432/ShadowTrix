import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { adminFallback, cell, Chip, DataTable, Facts, HistoryList, PageHeading, Section } from "@/components/admin/admin-ui";
import { AdminShell } from "@/components/admin/admin-shell";
import { MaintenanceControls } from "@/components/admin/maintenance-controls";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
import { getPlatformStatus } from "@/server/modules/admin/maintenance.service";

export const metadata: Metadata = { title: "Maintenance", robots: { index: false, follow: false } };
export default function Page() {
  return (
    <Suspense fallback={adminFallback}>
      <AdminShell section="maintenance" returnTo="/admin/maintenance"><Body /></AdminShell>
    </Suspense>
  );
}

async function Body() {
  const actor = await requireUser("/admin/maintenance");
  await connection();
  const s = await getPlatformStatus(actor);
  const result = s.scheduler.lastResult as Record<string, unknown> | null;
  return (
    <>
      <PageHeading title="Maintenance" intro="Platform health and a safe read-only switch. Nothing on this page shows a secret or an environment value." />
      <Section id="health" title="Platform health">
        <DataTable caption="Platform health" columns={["Component", "Status", "Details"]} minWidth="36rem">
          <tr><th scope="row" className={`${cell} font-medium`}>Database</th><td className={cell}><Chip tone={s.database.up ? "good" : "bad"}>{s.database.up ? "Connected" : "Unreachable"}</Chip></td><td className={cell}>{s.database.latencyMs !== null ? `${s.database.latencyMs} ms for a test query` : "No answer"}</td></tr>
          <tr><th scope="row" className={`${cell} font-medium`}>File storage</th><td className={cell}><Chip tone={s.storage.configured ? "good" : "bad"}>{s.storage.configured ? "Configured" : "Not configured"}</Chip></td><td className={cell}>Driver: {s.storage.driver}. {s.storage.pendingUploads} upload(s) in progress, {s.storage.pendingDeletions} file deletion(s) queued{s.storage.failedDeletions ? `, ${s.storage.failedDeletions} retrying` : ""}.</td></tr>
          <tr><th scope="row" className={`${cell} font-medium`}>Email</th><td className={cell}><Chip tone={s.email.ready ? "good" : "warn"}>{s.email.ready ? "Ready" : "Not configured"}</Chip></td><td className={cell}>{s.email.ready ? "Verification and reset emails can be delivered." : `Sign-up and password reset are unavailable. ${s.email.problems.join("; ")}.`}</td></tr>
          <tr><th scope="row" className={`${cell} font-medium`}>Scheduled cleanup</th><td className={cell}><Chip tone={s.scheduler.endpointEnabled ? "good" : "warn"}>{s.scheduler.endpointEnabled ? "Enabled" : "Disabled"}</Chip></td>
            <td className={cell}>{s.scheduler.lastRunAt ? <>Last run <time dateTime={s.scheduler.lastRunAt.toISOString()}>{formatDateTime(s.scheduler.lastRunAt, "UTC")}</time>{result ? ` (${Object.entries(result).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(", ")})` : ""}</> : "No run recorded yet."}</td></tr>
        </DataTable>
      </Section>
      <Section id="mode" title="Maintenance mode">
        <p className="mb-4 flex items-center gap-3"><Chip tone={s.maintenance.enabled ? "warn" : "good"}>{s.maintenance.enabled ? "On (read-only)" : "Off"}</Chip>{s.maintenance.since && <span className="text-sm text-fg-muted">since {formatDateTime(new Date(s.maintenance.since), "UTC")}</span>}</p>
        <p className="mb-4 max-w-2xl text-sm text-fg-muted">While on, the public can still browse, but anything that changes data is paused (HTTP 503 with your message). Administration, sign-in and sign-out stay available, and the scheduled cleanup is not affected.</p>
        <MaintenanceControls enabled={s.maintenance.enabled} message={s.maintenance.message} />
      </Section>
      <Section id="facts" title="Notes"><Facts items={[["Environment values", "Never shown"], ["Arbitrary commands", "Not available"]]} /></Section>
      <Section id="hist" title="Maintenance history"><HistoryList items={s.history.map((h) => ({ id: h.id, action: (h.details as { enabled?: boolean } | null)?.enabled ? "maintenance mode turned on" : "maintenance mode turned off", at: h.at, by: h.by }))} /></Section>
    </>
  );
}
