import type { Metadata } from "next";
import { Suspense } from "react";
import { ProtectedArea } from "@/components/auth/protected-area";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { ROLE_LABEL } from "@/lib/roles";
import { listUsers } from "@/server/modules/admin/admin-users.service";
import { getCurrentUser } from "@/server/modules/auth/dal";

export const metadata: Metadata = { title: "Administration", robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <Suspense fallback={<Container className="py-14"><Skeleton className="h-64 w-full" /></Container>}>
      <ProtectedArea permission="admin:access" returnTo="/admin" area="administration">
        <Container className="py-14 sm:py-20">
          <h1 className="text-h1 font-semibold">Administration</h1>
          <p className="mt-3 max-w-2xl text-fg-muted text-pretty">
            Read-only user list. Roles and account status are managed through the administrator API for now; a management interface arrives with the admin dashboard milestone.
          </p>
          <UsersTable />
        </Container>
      </ProtectedArea>
    </Suspense>
  );
}

/** Only rendered after ProtectedArea has allowed the request, and it re-checks permission inside the service. */
async function UsersTable() {
  const actor = (await getCurrentUser())!;
  const { items, total } = await listUsers(actor, { page: 1, pageSize: 25 });
  return (
    <div className="mt-10">
      <p className="mb-3 text-sm text-fg-muted">
        Showing {items.length} of {total} users
      </p>
      <div tabIndex={0} role="region" aria-label="Registered users (scrollable table)" className="overflow-x-auto rounded-lg shadow-card">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <caption className="sr-only">Registered users</caption>
          <thead className="bg-surface-raised text-fg-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Name</th>
              <th scope="col" className="px-4 py-3 font-medium">Email</th>
              <th scope="col" className="px-4 py-3 font-medium">Roles</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-surface">
            {items.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium">{u.fullName}</td>
                <td className="px-4 py-3 break-all text-fg-muted">{u.email}</td>
                <td className="px-4 py-3">
                  <span className="flex flex-wrap gap-1.5">
                    {[...new Set(u.roles.map((r) => r.role))].map((r) => (
                      <Badge key={r}>{ROLE_LABEL[r] ?? r}</Badge>
                    ))}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {u.status === "SUSPENDED" ? "Suspended" : u.emailVerified ? "Active" : "Awaiting email confirmation"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
