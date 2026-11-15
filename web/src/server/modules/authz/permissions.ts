/**
 * Role-based access control. Pure functions, no database or Next imports, so the whole permission
 * matrix is unit-testable and the module is portable.
 *
 * Roles are always loaded from the database for the authenticated user on every request; a role value
 * sent by the client is never trusted.
 */
export type Role = "PARTICIPANT" | "TEAM_LEADER" | "ORGANIZER" | "JUDGE" | "ADMIN";

export const PERMISSIONS = [
  "account:manage_own",
  "event:view",
  "event:register",
  "team:manage_own",
  "event:manage", // create/edit/publish events, manage participants
  "event:judge", // score assigned submissions
  "admin:access",
  "users:read",
  "users:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const PARTICIPANT: Permission[] = ["account:manage_own", "event:view", "event:register"];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  PARTICIPANT,
  // Team Leader is contextual (derived from team membership), it adds team management on top of participant rights.
  TEAM_LEADER: [...PARTICIPANT, "team:manage_own"],
  ORGANIZER: [...PARTICIPANT, "event:manage"],
  JUDGE: [...PARTICIPANT, "event:judge"],
  ADMIN: PERMISSIONS,
};

export interface RoleGrant {
  role: Role;
  /** Grant applies only to this event. null/undefined = platform-wide. */
  eventId?: string | null;
  organizationId?: string | null;
}

export interface Actor {
  id: string;
  roles: readonly RoleGrant[];
}

export interface Scope {
  eventId?: string;
  organizationId?: string;
}

/**
 * True when the actor holds a grant whose role includes the permission and whose scope covers the request.
 * A platform-wide grant (no scope) covers everything; an event-scoped grant covers only that event;
 * an event-scoped grant never satisfies a request that names no event.
 */
export function can(actor: Actor | null | undefined, permission: Permission, scope: Scope = {}): boolean {
  if (!actor) return false;
  return actor.roles.some((g) => {
    if (!ROLE_PERMISSIONS[g.role]?.includes(permission)) return false;
    if (g.eventId) return scope.eventId === g.eventId;
    if (g.organizationId) return scope.organizationId === g.organizationId;
    return true;
  });
}

export function hasGlobalRole(actor: Actor | null | undefined, role: Role): boolean {
  return !!actor?.roles.some((g) => g.role === role && !g.eventId && !g.organizationId);
}

/** Roles that can be assigned directly. TEAM_LEADER is derived from team membership, never granted by hand. */
export const ASSIGNABLE_ROLES: readonly Role[] = ["PARTICIPANT", "ORGANIZER", "JUDGE", "ADMIN"];
