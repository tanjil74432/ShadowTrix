import { connection } from "next/server";
import { getMaintenanceState } from "@/server/modules/admin/maintenance.service";

/** Shown on every page while maintenance mode is on. Streams in (never blocks the page) and renders nothing when the mode is off. */
export async function MaintenanceBanner() {
  await connection();
  const s = await getMaintenanceState();
  if (!s.enabled) return null;
  return (
    <div role="status" className="border-b border-warning/50 bg-warning/10 px-4 py-2 text-center text-sm text-fg">
      <strong className="font-semibold">Maintenance.</strong> {s.message}
    </div>
  );
}
