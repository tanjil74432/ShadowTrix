import { getDb } from "@/server/db/client";
import { createEventSchema } from "@/server/modules/events/event.schema";
import { createEvent, setEventStatus } from "@/server/modules/events/events.service";
import { actorOf, createUser } from "./auth-harness";

export const DAY = 86_400_000;
export const iso = (offsetDays: number, base = Date.now()) => new Date(base + offsetDays * DAY).toISOString();
let seq = 0;

export function eventInput(overrides: Record<string, unknown> = {}) {
  return createEventSchema.parse({
    title: `vt event ${Date.now().toString(36)}${seq++}`,
    category: "HACKATHON",
    summary: "A short but sufficient summary of the test event.",
    description: "A longer description of the test event that is more than twenty characters.",
    registrationOpensAt: iso(-1),
    registrationClosesAt: iso(5),
    startsAt: iso(10),
    endsAt: iso(11),
    ...overrides,
  });
}

export const organizer = async () => {
  const u = await createUser({ roles: ["ORGANIZER"] });
  return { u, actor: actorOf(u) };
};

/** An ordinary participant. `actor` carries the email too, which invitation answers need. */
export const participant = async () => {
  const u = await createUser();
  return { u, actor: { ...actorOf(u), email: u.email } };
};

export const publishedEvent = async (owner: Awaited<ReturnType<typeof organizer>>, overrides: Record<string, unknown> = {}) => {
  const e = await createEvent(owner.actor, eventInput(overrides));
  await setEventStatus(owner.actor, e.id, "publish");
  return e;
};

/** A published team event with sensible defaults (2 to 3 members). */
export const teamEvent = (owner: Awaited<ReturnType<typeof organizer>>, overrides: Record<string, unknown> = {}) =>
  publishedEvent(owner, { registrationMode: "TEAM", minTeamSize: 2, maxTeamSize: 3, ...overrides });

export const db = () => getDb();
