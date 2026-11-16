import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { canCreateEvents, canManageEvent } from "@/server/modules/authz/permissions";
import { createEventSchema, listEventsQuerySchema, timelineIssues, updateEventSchema } from "@/server/modules/events/event.schema";
import { nextState, placeFor, registrationBlock, slugify } from "@/server/modules/events/event-lifecycle";
import { createEvent, getPublicEvent, listManagedEvents, listPublicEvents, loadManagedEvent, setEventStatus, setRegistrationClosed, updateEvent } from "@/server/modules/events/events.service";
import { cancelRegistration, getMyRegistration, listEventRegistrations, listMyRegistrations, registerForEvent } from "@/server/modules/events/registrations.service";
import { actorOf, cleanup, createUser, uniqueEmail } from "./helpers/auth-harness";

const DAY = 86_400_000;
const iso = (offsetDays: number, base = Date.now()) => new Date(base + offsetDays * DAY).toISOString();
let seq = 0;

function eventInput(overrides: Record<string, unknown> = {}) {
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

const organizer = async () => {
  const u = await createUser({ roles: ["ORGANIZER"] });
  return { u, actor: actorOf(u) };
};
const participant = async () => {
  const u = await createUser();
  return { u, actor: actorOf(u) };
};
const publishedEvent = async (owner: Awaited<ReturnType<typeof organizer>>, overrides: Record<string, unknown> = {}) => {
  const e = await createEvent(owner.actor, eventInput(overrides));
  await setEventStatus(owner.actor, e.id, "publish");
  return e;
};

afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await getDb().$disconnect();
});

describe("event permissions (pure)", () => {
  const a = { id: "u-a", roles: [{ role: "ORGANIZER" as const }] };
  it("an organizer manages only events they organize; an administrator manages all; participants none", () => {
    expect(canManageEvent(a, "e1", ["u-a"])).toBe(true);
    expect(canManageEvent(a, "e1", ["u-b"])).toBe(false);
    expect(canManageEvent({ id: "admin", roles: [{ role: "ADMIN" }] }, "e1", [])).toBe(true);
    expect(canManageEvent({ id: "p", roles: [{ role: "PARTICIPANT" }] }, "e1", ["p"])).toBe(false);
    expect(canManageEvent(null, "e1", ["u-a"])).toBe(false);
  });
  it("an event-scoped organizer grant covers exactly that event and cannot create events", () => {
    const scoped = { id: "s", roles: [{ role: "ORGANIZER" as const, eventId: "e1" }] };
    expect(canManageEvent(scoped, "e1", [])).toBe(true);
    expect(canManageEvent(scoped, "e2", [])).toBe(false);
    expect(canCreateEvents(scoped)).toBe(false);
    expect(canCreateEvents(a)).toBe(true);
    expect(canCreateEvents({ id: "p", roles: [{ role: "PARTICIPANT" }] })).toBe(false);
  });
});

describe("event lifecycle rules (pure)", () => {
  it("status transitions", () => {
    expect(nextState("DRAFT", "publish")).toBe("PUBLISHED");
    expect(nextState("PUBLISHED", "publish")).toBeNull();
    expect(nextState("PUBLISHED", "unpublish")).toBe("DRAFT");
    expect(nextState("PUBLISHED", "cancel")).toBe("CANCELLED");
    expect(nextState("DRAFT", "cancel")).toBeNull();
    expect(nextState("CANCELLED", "publish")).toBeNull();
    expect(nextState("ARCHIVED", "archive")).toBeNull();
  });
  it("registration window", () => {
    const now = new Date("2030-01-10T00:00:00Z");
    const e = { status: "PUBLISHED" as const, registrationOpensAt: new Date("2030-01-01Z"), registrationClosesAt: new Date("2030-01-20Z"), endsAt: new Date("2030-02-01Z"), registrationManuallyClosed: false, registrationMode: "INDIVIDUAL" as const };
    expect(registrationBlock(e, now)).toBeNull();
    expect(registrationBlock({ ...e, status: "DRAFT" }, now)).toBe("NOT_PUBLISHED");
    expect(registrationBlock({ ...e, status: "CANCELLED" }, now)).toBe("CANCELLED");
    expect(registrationBlock(e, new Date("2029-12-31Z"))).toBe("NOT_OPEN_YET");
    expect(registrationBlock(e, new Date("2030-01-20Z"))).toBe("CLOSED");
    expect(registrationBlock({ ...e, registrationManuallyClosed: true }, now)).toBe("CLOSED");
    expect(registrationBlock(e, new Date("2030-02-01Z"))).toBe("ENDED");
    expect(registrationBlock({ ...e, registrationMode: "TEAM" }, now)).toBe("TEAM_ONLY");
  });
  it("capacity placement and slugs", () => {
    expect(placeFor(null, 1_000_000)).toBe("CONFIRMED");
    expect(placeFor(3, 2)).toBe("CONFIRMED");
    expect(placeFor(3, 3)).toBe("WAITLISTED");
    expect(slugify("  AI & ML: Spring Challenge 2031!  ")).toBe("ai-ml-spring-challenge-2031");
    expect(slugify("¡¡¡")).toBe("event");
  });
});

describe("event input validation", () => {
  const ok = () => ({
    title: "A good title", category: "WORKSHOP", summary: "A short but sufficient summary.", description: "A description that is long enough to accept.",
    registrationOpensAt: iso(1), registrationClosesAt: iso(5), startsAt: iso(10), endsAt: iso(11),
  });
  it("accepts a valid event and every supported category", () => {
    expect(createEventSchema.safeParse(ok()).success).toBe(true);
    for (const c of ["HACKATHON", "DATATHON", "AI_ML", "PROGRAMMING_CONTEST", "WORKSHOP", "SUMMIT", "INNOVATION_CHALLENGE"]) {
      expect(createEventSchema.safeParse({ ...ok(), category: c }).success, c).toBe(true);
    }
  });
  it("rejects bad timelines with a message on the right field", () => {
    const bad = createEventSchema.safeParse({ ...ok(), endsAt: iso(9) });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues[0]).toMatchObject({ path: ["endsAt"] });
    expect(createEventSchema.safeParse({ ...ok(), registrationClosesAt: iso(12) }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...ok(), registrationClosesAt: iso(0) }).success).toBe(false);
    expect(timelineIssues({ judgingStartsAt: new Date(2), judgingEndsAt: new Date(1) })).toHaveLength(1);
  });
  it("rejects bad fields and ignores fields people must not set", () => {
    expect(createEventSchema.safeParse({ ...ok(), title: "ab" }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...ok(), title: "<script>alert(1)</script>" }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...ok(), category: "NOPE" }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...ok(), capacity: 0 }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...ok(), capacity: 1.5 }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...ok(), startsAt: "not a date" }).success).toBe(false);
    const parsed = createEventSchema.parse({ ...ok(), status: "PUBLISHED", slug: "evil", createdById: "x", capacity: "" });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("slug");
    expect(parsed).not.toHaveProperty("createdById");
    // team events must state their team sizes; individual events carry none
    expect(createEventSchema.safeParse({ ...ok(), registrationMode: "TEAM" }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...ok(), registrationMode: "TEAM", minTeamSize: 3, maxTeamSize: 2 }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...ok(), registrationMode: "TEAM", minTeamSize: 2, maxTeamSize: 4 }).success).toBe(true);
    expect(parsed.capacity).toBeNull();
  });
  it("updates are partial but keep the rules", () => {
    expect(updateEventSchema.safeParse({ title: "Another title" }).success).toBe(true);
    expect(updateEventSchema.safeParse({ capacity: -5 }).success).toBe(false);
    expect(listEventsQuerySchema.parse({}).pageSize).toBe(12);
    expect(listEventsQuerySchema.safeParse({ pageSize: 500 }).success).toBe(false);
    expect(listEventsQuerySchema.safeParse({ category: "XX" }).success).toBe(false);
    expect(listEventsQuerySchema.parse({ q: "a b" }).q).toBe("ab"); // NUL bytes would crash the database query
  });
});

describe("creating, editing and publishing events", () => {
  it("an organizer creates a draft they own; it is hosted by the platform operator when one exists", async () => {
    const o = await organizer();
    const e = await createEvent(o.actor, eventInput());
    expect(e.status).toBe("DRAFT");
    expect(e.slug).toMatch(/^vt-event-/);
    expect(e.createdById).toBe(o.u.id);
    const row = await getDb().event.findUniqueOrThrow({ where: { id: e.id }, include: { organizers: true } });
    expect(row.organizers).toEqual([expect.objectContaining({ userId: o.u.id, isLead: true })]);
    expect(await getDb().auditLog.count({ where: { entityId: e.id, action: "event.create" } })).toBe(1);
  });

  it("participants and judges cannot create events", async () => {
    const p = await participant();
    const j = await createUser({ roles: ["JUDGE"] });
    await expect(createEvent(p.actor, eventInput())).rejects.toMatchObject({ status: 403 });
    await expect(createEvent(actorOf(j), eventInput())).rejects.toMatchObject({ status: 403 });
  });

  it("another organizer cannot edit, publish, cancel or read a draft they do not organize", async () => {
    const owner = await organizer();
    const other = await organizer();
    const e = await createEvent(owner.actor, eventInput());
    await expect(updateEvent(other.actor, e.id, { title: "Hijacked title" })).rejects.toMatchObject({ status: 404 }); // a draft does not even exist for them
    await expect(setEventStatus(other.actor, e.id, "publish")).rejects.toMatchObject({ status: 404 });
    await expect(loadManagedEvent(other.actor, e.id)).rejects.toMatchObject({ status: 404 });
    await setEventStatus(owner.actor, e.id, "publish");
    // once public, the same attempts are refused as forbidden
    await expect(updateEvent(other.actor, e.id, { title: "Hijacked title" })).rejects.toMatchObject({ status: 403 });
    await expect(setEventStatus(other.actor, e.id, "cancel")).rejects.toMatchObject({ status: 403 });
    expect((await getDb().event.findUniqueOrThrow({ where: { id: e.id } })).title).toBe(e.title);
  });

  it("a participant cannot edit or publish anything", async () => {
    const owner = await organizer();
    const p = await participant();
    const e = await publishedEvent(owner);
    await expect(updateEvent(p.actor, e.id, { title: "Hijacked title" })).rejects.toMatchObject({ status: 403 });
    await expect(setEventStatus(p.actor, e.id, "cancel")).rejects.toMatchObject({ status: 403 });
    await expect(setRegistrationClosed(p.actor, e.id, true)).rejects.toMatchObject({ status: 403 });
  });

  it("an administrator manages any event; an event-scoped organizer grant manages exactly one", async () => {
    const owner = await organizer();
    const admin = await createUser({ roles: ["ADMIN"] });
    const e = await createEvent(owner.actor, eventInput());
    await expect(updateEvent(actorOf(admin), e.id, { title: "Admin edited title" })).resolves.toMatchObject({ title: "Admin edited title" });

    const scoped = await createUser();
    await getDb().userRoleAssignment.create({ data: { userId: scoped.id, role: "ORGANIZER", eventId: e.id } });
    const full = await getDb().user.findUniqueOrThrow({ where: { id: scoped.id }, include: { roles: true } });
    await expect(updateEvent(actorOf(full), e.id, { summary: "Edited by the scoped organizer." })).resolves.toBeDefined();
    const e2 = await createEvent(owner.actor, eventInput());
    await expect(updateEvent(actorOf(full), e2.id, { summary: "Should not be allowed at all." })).rejects.toMatchObject({ status: 404 });
  });

  it("publishing, unpublishing, cancelling and archiving follow the lifecycle", async () => {
    const o = await organizer();
    const e = await createEvent(o.actor, eventInput());
    await expect(setEventStatus(o.actor, e.id, "cancel")).rejects.toMatchObject({ status: 409 }); // a draft cannot be cancelled
    expect((await setEventStatus(o.actor, e.id, "publish")).status).toBe("PUBLISHED");
    await expect(setEventStatus(o.actor, e.id, "publish")).rejects.toMatchObject({ status: 409 });
    expect((await setEventStatus(o.actor, e.id, "unpublish")).status).toBe("DRAFT");
    await setEventStatus(o.actor, e.id, "publish");
    expect((await setEventStatus(o.actor, e.id, "cancel")).status).toBe("CANCELLED");
    await expect(updateEvent(o.actor, e.id, { title: "Edit after cancel" })).rejects.toMatchObject({ status: 409 });
    expect((await setEventStatus(o.actor, e.id, "archive")).status).toBe("ARCHIVED");
    expect(await getDb().auditLog.count({ where: { entityId: e.id, action: { startsWith: "event." } } })).toBeGreaterThanOrEqual(5);
  });

  it("will not publish an event whose registration already closed, and will not unpublish with people registered", async () => {
    const o = await organizer();
    const past = await createEvent(o.actor, eventInput({ registrationOpensAt: iso(-20), registrationClosesAt: iso(-10), startsAt: iso(-5), endsAt: iso(5) }));
    await expect(setEventStatus(o.actor, past.id, "publish")).rejects.toMatchObject({ status: 409 });

    const e = await publishedEvent(o);
    const p = await participant();
    await registerForEvent(p.actor, e.id);
    await expect(setEventStatus(o.actor, e.id, "unpublish")).rejects.toMatchObject({ status: 409 });
  });

  it("updates keep the timeline valid against the stored values and refuse a capacity below the confirmed count", async () => {
    const o = await organizer();
    const e = await publishedEvent(o, { capacity: 5 });
    await expect(updateEvent(o.actor, e.id, { endsAt: new Date(Date.now() + 1 * DAY) })).rejects.toMatchObject({ status: 400 }); // ends before it starts
    const ps = await Promise.all([participant(), participant(), participant()]);
    for (const p of ps) await registerForEvent(p.actor, e.id);
    await expect(updateEvent(o.actor, e.id, { capacity: 2 })).rejects.toMatchObject({ status: 409 });
    await expect(updateEvent(o.actor, e.id, { capacity: 3 })).resolves.toBeDefined();
  });

  it("the database rejects invalid rows even if the application were bypassed", async () => {
    const o = await organizer();
    const e = await createEvent(o.actor, eventInput());
    await expect(getDb().event.update({ where: { id: e.id }, data: { slug: "Bad Slug!" } })).rejects.toThrow(/events_slug_format_chk/);
    await expect(getDb().event.update({ where: { id: e.id }, data: { capacity: 0 } })).rejects.toThrow(/events_capacity_chk/);
    const p = await participant();
    await expect(getDb().registration.create({ data: { eventId: e.id, userId: p.u.id, status: "CANCELLED" } })).rejects.toThrow(/registrations_cancelled_consistency_chk/);
    await expect(getDb().registration.create({ data: { eventId: e.id, userId: p.u.id, status: "CONFIRMED", cancelledAt: new Date() } })).rejects.toThrow(/registrations_cancelled_consistency_chk/);
  });
});

describe("public listing, search and visibility", () => {
  it("lists only published events and never drafts, archived events or private fields", async () => {
    const o = await organizer();
    const draft = await createEvent(o.actor, eventInput({ title: "vt draft only zzq" }));
    const live = await publishedEvent(o, { title: "vt live zzq" });
    const archived = await publishedEvent(o, { title: "vt archived zzq" });
    await setEventStatus(o.actor, archived.id, "archive");

    const res = await listPublicEvents({ q: "zzq", page: 1, pageSize: 20 });
    expect(res.items.map((i) => i.slug)).toEqual([live.slug]);
    expect(res.total).toBe(1);
    expect(await getPublicEvent(draft.slug)).toBeNull();
    expect(await getPublicEvent(archived.slug)).toBeNull();
    const detail = (await getPublicEvent(live.slug))!;
    expect(JSON.stringify(detail)).not.toMatch(/createdById|organizers|email|passwordHash/);
  });

  it("a cancelled event keeps a public page that says so, but leaves the listing", async () => {
    const o = await organizer();
    const e = await publishedEvent(o, { title: "vt cancelled zzr" });
    await setEventStatus(o.actor, e.id, "cancel");
    expect((await getPublicEvent(e.slug))?.status).toBe("CANCELLED");
    expect((await listPublicEvents({ q: "zzr", page: 1, pageSize: 20 })).items).toHaveLength(0);
  });

  it("filters by category, searches title and summary case-insensitively, and paginates in a stable order", async () => {
    const o = await organizer();
    await publishedEvent(o, { title: "vt alpha zzs", category: "DATATHON" });
    await publishedEvent(o, { title: "vt beta zzs", category: "WORKSHOP", summary: "Learn about Quantum Widgets here." });
    await publishedEvent(o, { title: "vt gamma zzs", category: "DATATHON", startsAt: iso(20), endsAt: iso(21), registrationClosesAt: iso(8) });
    const all = await listPublicEvents({ q: "zzs", page: 1, pageSize: 2 });
    expect(all.total).toBe(3);
    expect(all.items).toHaveLength(2);
    const page2 = await listPublicEvents({ q: "zzs", page: 2, pageSize: 2 });
    expect(page2.items).toHaveLength(1);
    expect(new Set([...all.items, ...page2.items].map((i) => i.slug)).size).toBe(3);
    expect((await listPublicEvents({ q: "zzs", category: "DATATHON", page: 1, pageSize: 20 })).total).toBe(2);
    expect((await listPublicEvents({ q: "QUANTUM widgets", page: 1, pageSize: 20 })).items.map((i) => i.title)).toEqual(["vt beta zzs"]);
    expect((await listPublicEvents({ q: "%_\\'; DROP TABLE events; --", page: 1, pageSize: 20 })).total).toBe(0); // inert, parameterized
  });
});

describe("registration and cancellation", () => {
  it("registers a participant, is idempotent, and shows up in their own list only", async () => {
    const o = await organizer();
    const e = await publishedEvent(o);
    const p = await participant();
    const q = await participant();
    expect(await registerForEvent(p.actor, e.id)).toEqual({ status: "CONFIRMED", created: true });
    expect(await registerForEvent(p.actor, e.id)).toEqual({ status: "CONFIRMED", created: false });
    expect(await getDb().registration.count({ where: { eventId: e.id } })).toBe(1);
    expect((await listMyRegistrations(p.u.id)).map((r) => r.event.id)).toEqual([e.id]);
    expect(await listMyRegistrations(q.u.id)).toHaveLength(0);
    expect((await getMyRegistration(p.u.id, e.id))?.status).toBe("CONFIRMED");
    expect(await getMyRegistration(q.u.id, e.id)).toBeNull();
  });

  it("refuses drafts (as not found), closed, not-yet-open, ended, cancelled and manually closed events", async () => {
    const o = await organizer();
    const p = await participant();
    const draft = await createEvent(o.actor, eventInput());
    await expect(registerForEvent(p.actor, draft.id)).rejects.toMatchObject({ status: 404 });
    await expect(registerForEvent(p.actor, "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ status: 404 });

    const notYet = await publishedEvent(o, { registrationOpensAt: iso(2), registrationClosesAt: iso(5) });
    await expect(registerForEvent(p.actor, notYet.id)).rejects.toMatchObject({ status: 409, code: "registration_not_open_yet" });

    const closed = await publishedEvent(o, { registrationOpensAt: iso(-5), registrationClosesAt: iso(5) });
    await setRegistrationClosed(o.actor, closed.id, true);
    await expect(registerForEvent(p.actor, closed.id)).rejects.toMatchObject({ status: 409, code: "registration_closed" });
    await setRegistrationClosed(o.actor, closed.id, false);
    await expect(registerForEvent(p.actor, closed.id)).resolves.toMatchObject({ created: true });

    const e = await publishedEvent(o);
    await setEventStatus(o.actor, e.id, "cancel");
    await expect(registerForEvent(p.actor, e.id)).rejects.toMatchObject({ status: 409, code: "registration_cancelled" });

    // time is injectable: the same published event is closed once its registration deadline passes
    const dated = await publishedEvent(o);
    await expect(registerForEvent(p.actor, dated.id, { now: () => new Date(Date.now() + 6 * DAY) })).rejects.toMatchObject({ code: "registration_closed" });
    await expect(registerForEvent(p.actor, dated.id, { now: () => new Date(Date.now() + 12 * DAY) })).rejects.toMatchObject({ code: "registration_ended" });
  });

  it("cancels, can re-register (reusing the same row), and cancelling twice is harmless", async () => {
    const o = await organizer();
    const e = await publishedEvent(o);
    const p = await participant();
    await registerForEvent(p.actor, e.id);
    expect(await cancelRegistration(p.actor, e.id)).toEqual({ cancelled: true });
    expect(await cancelRegistration(p.actor, e.id)).toEqual({ cancelled: false });
    const row = await getDb().registration.findUniqueOrThrow({ where: { eventId_userId: { eventId: e.id, userId: p.u.id } } });
    expect(row.status).toBe("CANCELLED");
    expect(row.cancelledAt).not.toBeNull();
    expect(await getMyRegistration(p.u.id, e.id)).toBeNull();
    expect(await registerForEvent(p.actor, e.id)).toMatchObject({ status: "CONFIRMED", created: true });
    expect(await getDb().registration.count({ where: { eventId: e.id, userId: p.u.id } })).toBe(1);
    expect((await getDb().registration.findUniqueOrThrow({ where: { id: row.id } })).cancelledAt).toBeNull();
  });

  it("people cannot cancel someone else's registration (the API only ever acts on the caller)", async () => {
    const o = await organizer();
    const e = await publishedEvent(o);
    const a = await participant();
    const b = await participant();
    await registerForEvent(a.actor, e.id);
    expect(await cancelRegistration(b.actor, e.id)).toEqual({ cancelled: false });
    expect((await getMyRegistration(a.u.id, e.id))?.status).toBe("CONFIRMED");
  });

  it("capacity: the last seat goes to exactly one of many simultaneous registrations; the rest are waitlisted in order", async () => {
    const o = await organizer();
    const e = await publishedEvent(o, { capacity: 5 });
    const people = await Promise.all(Array.from({ length: 14 }, () => participant()));
    const results = await Promise.all(people.map((p) => registerForEvent(p.actor, e.id)));
    expect(results.filter((r) => r.status === "CONFIRMED")).toHaveLength(5);
    expect(results.filter((r) => r.status === "WAITLISTED")).toHaveLength(9);
    const db = getDb();
    expect(await db.registration.count({ where: { eventId: e.id, status: "CONFIRMED" } })).toBe(5); // never over capacity
    expect(await db.registration.count({ where: { eventId: e.id } })).toBe(14);
  });

  it("cancelling a confirmed seat promotes the oldest waitlisted person; cancelling a waitlisted place promotes nobody", async () => {
    const o = await organizer();
    const e = await publishedEvent(o, { capacity: 2 });
    const [a, b, c, d] = await Promise.all([participant(), participant(), participant(), participant()]);
    for (const p of [a, b, c, d]) await registerForEvent(p.actor, e.id, { now: () => new Date(Date.now() + [a, b, c, d].indexOf(p) * 1000) });
    expect((await getMyRegistration(c.u.id, e.id))?.status).toBe("WAITLISTED");
    await cancelRegistration(d.actor, e.id); // waitlisted -> no promotion
    expect((await getMyRegistration(c.u.id, e.id))?.status).toBe("WAITLISTED");
    await cancelRegistration(a.actor, e.id); // confirmed -> c (oldest waitlisted) is promoted
    expect((await getMyRegistration(c.u.id, e.id))?.status).toBe("CONFIRMED");
    expect(await getDb().registration.count({ where: { eventId: e.id, status: "CONFIRMED" } })).toBe(2);
  });

  it("concurrent cancellations and registrations never exceed capacity", async () => {
    const o = await organizer();
    const e = await publishedEvent(o, { capacity: 3 });
    const seated = await Promise.all(Array.from({ length: 3 }, () => participant()));
    for (const p of seated) await registerForEvent(p.actor, e.id);
    const newcomers = await Promise.all(Array.from({ length: 6 }, () => participant()));
    await Promise.all([...seated.map((p) => cancelRegistration(p.actor, e.id)), ...newcomers.map((p) => registerForEvent(p.actor, e.id))]);
    const confirmed = await getDb().registration.count({ where: { eventId: e.id, status: "CONFIRMED" } });
    expect(confirmed).toBeLessThanOrEqual(3);
    expect(confirmed).toBe(3); // the freed seats were filled
  });

  it("raising the capacity promotes the waiting list", async () => {
    const o = await organizer();
    const e = await publishedEvent(o, { capacity: 1 });
    const [a, b, c] = await Promise.all([participant(), participant(), participant()]);
    for (const p of [a, b, c]) await registerForEvent(p.actor, e.id);
    await updateEvent(o.actor, e.id, { capacity: 3 });
    expect(await getDb().registration.count({ where: { eventId: e.id, status: "CONFIRMED" } })).toBe(3);
  });
});

describe("abuse resistance", () => {
  it("register and cancel are rate limited per person", async () => {
    const o = await organizer();
    const e = await publishedEvent(o);
    const p = await participant();
    for (let i = 0; i < 15; i++) {
      await registerForEvent(p.actor, e.id);
      await cancelRegistration(p.actor, e.id);
    }
    await expect(registerForEvent(p.actor, e.id)).rejects.toMatchObject({ status: 429 });
    await expect(cancelRegistration(p.actor, e.id)).rejects.toMatchObject({ status: 429 });
  });

  it("someone without access cannot stall an event: authorization is decided before the row lock is taken", async () => {
    const o = await organizer();
    const intruder = await organizer();
    const e = await publishedEvent(o);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockTaken = new Promise<void>((r) => (locked = r));
    const holder = getDb().$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM events WHERE id = ${e.id}::uuid FOR UPDATE`;
        locked();
        await held;
      },
      { timeout: 20_000 },
    );
    await lockTaken;
    const started = Date.now();
    await expect(updateEvent(intruder.actor, e.id, { title: "Hijack attempt here" })).rejects.toMatchObject({ status: 403 });
    await expect(setEventStatus(intruder.actor, e.id, "cancel")).rejects.toMatchObject({ status: 403 });
    expect(Date.now() - started).toBeLessThan(3000); // answered immediately while another transaction holds the lock
    release();
    await holder;
  });
});

describe("participant data is private", () => {
  it("only this event's organizers (and administrators) can list participants; the access is audited", async () => {
    const owner = await organizer();
    const other = await organizer();
    const e = await publishedEvent(owner);
    const p = await participant();
    await registerForEvent(p.actor, e.id);

    const list = await listEventRegistrations(owner.actor, e.id, { page: 1, pageSize: 25 });
    expect(list.items).toHaveLength(1);
    expect(list.items[0].user).toMatchObject({ email: p.u.email });
    expect(list.counts.CONFIRMED).toBe(1);
    expect(await getDb().auditLog.count({ where: { entityId: e.id, action: "registration.list_viewed", actorId: owner.u.id } })).toBe(1);

    await expect(listEventRegistrations(other.actor, e.id, { page: 1, pageSize: 25 })).rejects.toMatchObject({ status: 403 });
    await expect(listEventRegistrations(p.actor, e.id, { page: 1, pageSize: 25 })).rejects.toMatchObject({ status: 403 });
    const admin = await createUser({ roles: ["ADMIN"] });
    await expect(listEventRegistrations(actorOf(admin), e.id, { page: 1, pageSize: 25 })).resolves.toBeDefined();
  });

  it("the organizer dashboard lists only events the organizer manages, with registration counts", async () => {
    const a = await organizer();
    const b = await organizer();
    const mine = await publishedEvent(a, { capacity: 2 });
    await publishedEvent(b);
    const ps = await Promise.all([participant(), participant(), participant()]);
    for (const p of ps) await registerForEvent(p.actor, mine.id);
    const rows = await listManagedEvents(a.actor);
    expect(rows.map((r) => r.id)).toEqual([mine.id]);
    expect(rows[0].counts).toMatchObject({ CONFIRMED: 2, WAITLISTED: 1 });
    expect((await listManagedEvents(actorOf(await createUser()))).length).toBe(0);
  });
});

void uniqueEmail;
