import "server-only";
import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id parameters. OWASP's minimum is m=19 MiB, t=2, p=1; we use 64 MiB / 3 passes / 1 lane
 * (about 120 ms on a developer laptop), which costs an attacker far more per guess while keeping
 * login latency reasonable. Parameters are embedded in each hash, so raising them later is safe:
 * users are re-hashed transparently at their next login (see needsRehash).
 */
// algorithm: 2 is Argon2id (the library's const enum cannot be imported under isolatedModules; tests assert the "$argon2id$" prefix).
export const ARGON2_PARAMS = { algorithm: 2, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_PARAMS);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false; // malformed hash must never crash login or leak details
  }
}

/** True when the stored hash was made with weaker parameters than the current ones. */
export function needsRehash(storedHash: string): boolean {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(storedHash);
  if (!m) return true;
  return Number(m[1]) < ARGON2_PARAMS.memoryCost || Number(m[2]) < ARGON2_PARAMS.timeCost || Number(m[3]) < ARGON2_PARAMS.parallelism;
}

/**
 * A real hash of a random value, computed once per process. Verifying against it when the email is unknown
 * makes "no such user" cost the same as "wrong password", so response time does not reveal which emails exist.
 */
let dummyHash: Promise<string> | undefined;
export async function burnPasswordVerification(password: string): Promise<void> {
  dummyHash ??= hashPassword(`dummy-${Math.random()}-${Date.now()}`);
  await verifyPassword(await dummyHash, password);
}
