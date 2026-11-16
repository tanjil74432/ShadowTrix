/** Pure rules for event publication state and for who can register when. No database, no clock (callers pass `now`). */
export type EventState = "DRAFT" | "PUBLISHED" | "CANCELLED" | "ARCHIVED";
export type StatusAction = "publish" | "unpublish" | "cancel" | "archive";

const TRANSITIONS: Record<StatusAction, { from: readonly EventState[]; to: EventState }> = {
  publish: { from: ["DRAFT"], to: "PUBLISHED" },
  unpublish: { from: ["PUBLISHED"], to: "DRAFT" }, // only while nobody is registered (checked by the service)
  cancel: { from: ["PUBLISHED"], to: "CANCELLED" },
  archive: { from: ["PUBLISHED", "CANCELLED", "DRAFT"], to: "ARCHIVED" },
};

export function nextState(current: EventState, action: StatusAction): EventState | null {
  const t = TRANSITIONS[action];
  return t.from.includes(current) ? t.to : null;
}

export interface RegistrationWindow {
  status: EventState;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  endsAt: Date;
  registrationManuallyClosed: boolean;
  registrationMode: "INDIVIDUAL" | "TEAM";
}

export type RegistrationBlock = "NOT_PUBLISHED" | "NOT_OPEN_YET" | "CLOSED" | "ENDED" | "CANCELLED" | "TEAM_ONLY" | "INDIVIDUAL_ONLY";

/** Why a new registration is not possible right now, or null when it is. Capacity is decided separately (it needs a lock). */
export function registrationBlock(e: RegistrationWindow, now: Date, kind: "individual" | "team" = "individual"): RegistrationBlock | null {
  if (e.status === "CANCELLED") return "CANCELLED";
  if (e.status !== "PUBLISHED") return "NOT_PUBLISHED";
  if (e.registrationMode === "TEAM" && kind === "individual") return "TEAM_ONLY";
  if (e.registrationMode === "INDIVIDUAL" && kind === "team") return "INDIVIDUAL_ONLY";
  if (now >= e.endsAt) return "ENDED";
  if (now < e.registrationOpensAt) return "NOT_OPEN_YET";
  if (e.registrationManuallyClosed || now >= e.registrationClosesAt) return "CLOSED";
  return null;
}

export const BLOCK_MESSAGE: Record<RegistrationBlock, string> = {
  NOT_PUBLISHED: "This event is not open for registration.",
  NOT_OPEN_YET: "Registration for this event has not opened yet.",
  CLOSED: "Registration for this event is closed.",
  ENDED: "This event has ended.",
  CANCELLED: "This event was cancelled.",
  TEAM_ONLY: "This event is for teams. Create a team or accept an invitation to take part.",
  INDIVIDUAL_ONLY: "This event is for individual participants, not teams.",
};

/** A confirmed place when there is room, otherwise the waiting list. */
export function placeFor(capacity: number | null, confirmed: number): "CONFIRMED" | "WAITLISTED" {
  return capacity == null || confirmed < capacity ? "CONFIRMED" : "WAITLISTED";
}

export function slugify(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s || "event";
}
