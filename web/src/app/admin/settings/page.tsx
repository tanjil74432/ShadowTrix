import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/modules/auth/dal";
const fallback = <Container className="py-14"><Skeleton className="h-96 w-full" /></Container>;
import { ApiButton } from "@/components/common/api-button";
import { getApprovalRequired } from "@/server/modules/events/approval-setting";
import { getPlatformConfig } from "@/server/modules/admin/platform-config.service";

export const metadata: Metadata = { title: "Settings", robots: { index: false, follow: false } };

export default function SettingsAdminPage() {
  return <Suspense fallback={fallback}><AdminShell section="settings" returnTo="/admin/settings"><Content /></AdminShell></Suspense>;
}

async function Content() {
  const actor = await requireUser("/admin/settings");
  await connection();
  const c = await getPlatformConfig(actor);
  const approvalRequired = await getApprovalRequired();
  const rows: [string, string][] = [
    ["Environment", c.environment], ["Public address (APP_URL)", c.appUrl], ["HTTPS", c.https ? "yes" : "no (acceptable only for local development)"], ["Trusting proxy headers (TRUST_PROXY)", c.trustProxy ? "yes" : "no"],
    ["Session lifetime", `${c.sessions.absoluteDays} days at most, ${c.sessions.idleDays} days idle`],
    ["Email server", `${c.email.host}:${c.email.port}${c.email.secure ? " (TLS)" : ""}, sender ${c.email.from}, credentials ${c.email.credentialsConfigured ? "configured" : "not configured"}`],
    ["File storage", `${c.storage.driver}${c.storage.implemented ? "" : " (not implemented: uploads will fail)"}`], ["Scheduled cleanup endpoint", c.cleanupEndpointEnabled ? "enabled (secret configured)" : "disabled"],
    ["Password length", `${c.policies.passwordLength.min} to ${c.policies.passwordLength.max} characters`], ["Upload limits", `${c.policies.uploads.maxFileMegabytes} MB per file, ${c.policies.uploads.maxFilesPerSubmission} files per project`],
    ["Link lifetimes", `confirmation ${c.policies.verificationLinkHours} h, password reset ${c.policies.resetLinkMinutes} min, team invitation ${c.policies.invitationDays} days`],
    ["Event categories", c.eventCategories.map((x) => x.toLowerCase().replace(/_/g, " ")).join(", ")],
  ];
  return (
    <>
      <h1 className="text-h1 font-semibold">Settings</h1>
      <p className="mt-2 max-w-3xl text-fg-muted">Secrets (database address, signing key, email password, scheduler secret) are never shown here. Deployment values are changed in the server environment, not in this page. Event categories are fixed in the code because events, filters and statistics depend on them.</p>
      <section aria-labelledby="signups-heading" className="mt-8 max-w-2xl space-y-3 rounded-lg bg-surface p-5 shadow-card">
        <h2 id="signups-heading" className="text-h3 font-semibold">New registrations</h2>
        <p role="status">New account registration is currently <strong>{c.signupsEnabled ? "open" : "paused"}</strong>. Existing accounts keep working either way.</p>
        <ApiButton url="/api/v1/admin/settings" method="PATCH" body={{ signupsEnabled: !c.signupsEnabled }} confirm={c.signupsEnabled ? "Pause new registrations?" : "Resume new registrations?"}>{c.signupsEnabled ? "Pause new registrations" : "Resume new registrations"}</ApiButton>
      </section>
      <section aria-labelledby="approval-heading" className="mt-6 max-w-2xl space-y-3 rounded-lg bg-surface p-5 shadow-card">
        <h2 id="approval-heading" className="text-h3 font-semibold">Event approval</h2>
        <p role="status">Organizers <strong>{approvalRequired ? "need" : "do not need"}</strong> administrator approval before publishing an event. Administrators can always publish. Events already published are not affected.</p>
        <ApiButton url="/api/v1/admin/settings" method="PATCH" body={{ eventApprovalRequired: !approvalRequired }} confirm={approvalRequired ? "Stop requiring approval before publishing?" : "Require administrator approval before organizers publish events?"}>{approvalRequired ? "Stop requiring approval" : "Require approval"}</ApiButton>
      </section>
      <dl className="mt-8 max-w-3xl divide-y divide-border rounded-lg bg-surface shadow-card">
        {rows.map(([k, v]) => <div key={k} className="grid gap-1 px-5 py-3 sm:grid-cols-[14rem_1fr]"><dt className="text-sm text-fg-subtle">{k}</dt><dd className="break-words">{v}</dd></div>)}
      </dl>
      <section aria-labelledby="limits-heading" className="mt-8 max-w-3xl"><h2 id="limits-heading" className="text-h3 font-semibold">Rate limits</h2>
        <ul className="mt-3 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">{Object.entries(c.policies.rateLimits).map(([k, v]) => <li key={k}><span className="text-fg-muted">{k}:</span> {v}</li>)}</ul></section>
    </>
  );
}
