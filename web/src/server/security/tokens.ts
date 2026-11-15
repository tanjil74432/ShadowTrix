import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { getAuthSecret } from "@/server/config/env";

/** 256 bits from the OS CSPRNG, base64url (43 chars). Used for session, verification and reset tokens. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * SHA-256 of a token. Tokens are 256-bit random values, so a fast unsalted hash is appropriate
 * (there is nothing to brute-force). Only this hash is stored; a database leak cannot be replayed.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Keyed hash for identifiers we must not store in the clear (emails, IPs in rate-limit keys).
 * HMAC with the server secret stops anyone with a database dump from testing guesses offline.
 */
export function hmacId(namespace: string, value: string, secret: string = getAuthSecret()): string {
  return createHmac("sha256", secret).update(`${namespace}:${value}`).digest("hex");
}

/** Normalizes an email address for lookup and storage (the database also enforces lower-case). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
