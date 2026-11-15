import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { unauthorized, forbidden } from "@/server/http/errors";
import { can, type Permission, type Scope } from "@/server/modules/authz/permissions";
import { readSessionToken } from "./session-cookie";
import { getSessionUser, type SessionUser } from "./session.service";

/**
 * Data access layer for authentication. Every page, layout slot and route handler that needs the user goes
 * through here, so the session is validated against the database on each request (not just trusted from a cookie).
 * Deduplicated per request with React's cache().
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = await readSessionToken();
  // Session validity depends on the current time, so it can only be decided at request time.
  // Without this, Next.js's prerender passes would flag the clock read inside getSessionUser.
  await connection();
  const result = await getSessionUser(token);
  return result?.user ?? null;
});

/** Pages: redirects anonymous visitors to the login page, preserving where they were going. */
export async function requireUser(returnTo: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return user;
}

/**
 * Pages: authentication plus permission. `allowed` is false for signed-in users who lack the permission;
 * the page must then render the access-denied view and no protected data.
 */
export async function requirePageAccess(permission: Permission, returnTo: string, scope?: Scope) {
  const user = await requireUser(returnTo);
  return { user, allowed: can(user, permission, scope) };
}

/** Route handlers: 401 when anonymous. */
export async function requireApiUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  return user;
}

/** Route handlers: 401 when anonymous, 403 when the permission is missing. */
export async function requireApiPermission(permission: Permission, scope?: Scope): Promise<SessionUser> {
  const user = await requireApiUser();
  if (!can(user, permission, scope)) throw forbidden();
  return user;
}
