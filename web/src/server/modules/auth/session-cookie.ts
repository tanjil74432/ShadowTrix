import "server-only";
import { cookies } from "next/headers";
import { getEnv } from "@/server/config/env";
import { sessionMaxAgeSeconds } from "./session.service";

/**
 * Session cookie policy:
 *  - HttpOnly: JavaScript can never read the token (limits XSS impact).
 *  - Secure whenever APP_URL is https. In that case the "__Host-" prefix is used, which makes browsers
 *    require Secure, Path=/ and no Domain, so the cookie cannot be overwritten from a sibling subdomain.
 *  - SameSite=Lax: not sent on cross-site POSTs (CSRF defence in depth; the Origin check is the primary control).
 *  - Max-Age equals the absolute session lifetime; the server enforces expiry regardless.
 */
export interface CookieSettings {
  name: string;
  options: { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/"; maxAge: number };
}

export function cookieSettings(appUrl: string, maxAgeSeconds: number): CookieSettings {
  const secure = appUrl.startsWith("https://");
  return {
    name: secure ? "__Host-st_session" : "st_session",
    options: { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: maxAgeSeconds },
  };
}

function settings() {
  return cookieSettings(getEnv().APP_URL, sessionMaxAgeSeconds());
}

/** Route handlers and server actions only: cookies cannot be written during rendering. */
export async function setSessionCookie(token: string): Promise<void> {
  const { name, options } = settings();
  (await cookies()).set(name, token, options);
}

export async function clearSessionCookie(): Promise<void> {
  const { name, options } = settings();
  (await cookies()).set(name, "", { ...options, maxAge: 0 });
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(settings().name)?.value;
}
