"use client";

import { ApiButton } from "@/components/common/api-button";

const ASSIGNABLE = ["ORGANIZER", "JUDGE", "ADMIN"] as const;

/** Account status and global role changes. The server enforces the safeguards (no self-demotion, last administrator). */
export function UserActions({ userId, status, globalRoles, }: { userId: string; status: "ACTIVE" | "SUSPENDED"; globalRoles: string[]; isSelf?: boolean }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold">Account status</h3>
        <p className="mt-1 text-sm text-fg-muted">Suspending ends all of the person&apos;s sessions at once and blocks login.</p>
        <div className="mt-3">
          {status === "ACTIVE" ? (
            <ApiButton url={`/api/v1/admin/users/${userId}/status`} method="PATCH" body={{ status: "SUSPENDED" }} confirm="Suspend this account? They are signed out immediately.">
              Suspend account
            </ApiButton>
          ) : (
            <ApiButton url={`/api/v1/admin/users/${userId}/status`} method="PATCH" body={{ status: "ACTIVE" }}>Reactivate account</ApiButton>
          )}
        </div>
      </div>
      <div>
        <h3 className="font-semibold">Platform-wide roles</h3>
        <p className="mt-1 text-sm text-fg-muted">A role change signs the person out once so it takes effect. Event-specific roles are managed on the event.</p>
        <ul className="mt-3 flex flex-wrap gap-3">
          {ASSIGNABLE.map((role) => (
            <li key={role}>
              {globalRoles.includes(role) ? (
                <ApiButton url={`/api/v1/admin/users/${userId}/roles/${role}`} method="DELETE" confirm={`Remove the ${role.toLowerCase()} role?`}>Remove {role.toLowerCase()}</ApiButton>
              ) : (
                <ApiButton url={`/api/v1/admin/users/${userId}/roles`} body={{ role }} variant="ghost">Grant {role.toLowerCase()}</ApiButton>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
