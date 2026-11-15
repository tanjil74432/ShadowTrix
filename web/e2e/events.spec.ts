import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { COOKIE, JSON_HEADERS, NEW_PASSWORD, PASSWORD, createRawSession, db, expect, post, test, uiLogin, type TestUser } from "./helpers/fixtures";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const DAY = 86_400_000;
const asUser = async (u: TestUser) => ({ ...JSON_HEADERS, Cookie: `${COOKIE}=${await createRawSession(u.id)}` });
const alertOf = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');
const tag = () => randomUUID().slice(0, 6);

async function seedEvent(ownerId: string, o: Record<string, unknown> = {}) {
  const t = tag();
  const now = Date.now();
  return db().event.create({
    data: {
      slug: `e2e-event-${t}`,
      title: `E2E Event ${t}`,
      category: "HACKATHON",
      summary: `Summary of the end to end event ${t}.`,
      description: "Description paragraph one of the event.\n\nParagraph two explains the rules.",
      status: "PUBLISHED",
      registrationOpensAt: new Date(now - DAY),
      registrationClosesAt: new Date(now + 5 * DAY),
      startsAt: new Date(now + 10 * DAY),
      endsAt: new Date(now + 11 * DAY),
      createdById: ownerId,
      organizers: { create: { userId: ownerId, isLead: true } },
      ...o,
    },
  });
}

test.describe("public events", () => {
  test("lists published events with search and category filter; drafts and archived events never appear", async ({ page, users }) => {
    const owner = await users.create({ roles: ["ORGANIZER"] });
    const t = tag();
    const live = await seedEvent(owner.id, { title: `Aurora ${t} Hackathon`, category: "HACKATHON" });
    const data = await seedEvent(owner.id, { title: `Borealis ${t} Datathon`, category: "DATATHON", summary: "Wrangle a dataset together." });
    await seedEvent(owner.id, { title: `Hidden draft ${t}`, status: "DRAFT" });
    await seedEvent(owner.id, { title: `Hidden archive ${t}`, status: "ARCHIVED" });

    await page.goto(`/events?q=${t}`);
    await expect(page.getByRole("heading", { level: 1, name: "Events" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: live.title })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: data.title })).toBeVisible();
    await expect(page.getByText("Hidden draft")).toHaveCount(0);
    await expect(page.getByText("Hidden archive")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "2 events" })).toBeVisible();

    // the filter form works as a plain GET (no JavaScript needed) and keeps the URL shareable
    await page.getByLabel("Category").selectOption("DATATHON");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(new RegExp(`category=DATATHON`));
    await expect(page.getByRole("heading", { level: 2, name: data.title })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: live.title })).toHaveCount(0);

    await page.goto(`/events?q=nothing-matches-${t}-xyz`);
    await expect(page.getByRole("heading", { name: "No events match your search" })).toBeVisible();
    // garbage parameters do not break the page
    await page.goto("/events?page=-5&category=NOPE&q=%00");
    await expect(page.getByRole("heading", { level: 1, name: "Events" })).toBeVisible();
  });

  test("detail page shows the event, timeline and a login prompt; drafts and unknown slugs are 404", async ({ page, users }) => {
    const owner = await users.create({ roles: ["ORGANIZER"] });
    const e = await seedEvent(owner.id, { capacity: 50, eligibility: "Open to everyone aged 16 or over." });
    const draft = await seedEvent(owner.id, { status: "DRAFT" });

    await page.goto(`/events/${e.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: e.title })).toBeVisible();
    await expect(page).toHaveTitle(e.title);
    await expect(page.getByText("Paragraph two explains the rules.")).toBeVisible();
    await expect(page.getByText("Open to everyone aged 16 or over.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(page.getByText("0 of 50 taken")).toBeVisible();
    const login = page.getByRole("link", { name: "Log in to register" });
    await expect(login).toHaveAttribute("href", `/login?next=${encodeURIComponent(`/events/${e.slug}`)}`);

    // The page streams, so Next answers 200 and renders its not-found view; the draft's content must not be in it.
    for (const path of [`/events/${draft.slug}`, "/events/does-not-exist-anywhere", "/events/Bad%20Slug!"]) {
      await page.goto(path);
      await expect(page.getByText("This page could not be found.")).toBeVisible();
      await expect(page.getByText(draft.title)).toHaveCount(0);
      await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
    }
  });

  test("public API returns published events only and no private fields", async ({ request, users }) => {
    const owner = await users.create({ roles: ["ORGANIZER"] });
    const e = await seedEvent(owner.id);
    const draft = await seedEvent(owner.id, { status: "DRAFT" });
    const list = await request.get(`/api/v1/events?q=${e.slug.slice(-6)}`);
    expect(list.status()).toBe(200);
    const body = await list.json();
    expect(body.items.map((i: { slug: string }) => i.slug)).toEqual([e.slug]);
    expect(JSON.stringify(body)).not.toMatch(/createdById|email|organizers/);
    expect((await request.get(`/api/v1/events/by-slug/${e.slug}`)).status()).toBe(200);
    expect((await request.get(`/api/v1/events/by-slug/${draft.slug}`)).status()).toBe(404);
    expect((await request.get(`/api/v1/events?pageSize=9999`)).status()).toBe(400);
  });
});

test.describe("participant registration", () => {
  test("a participant registers, sees it on the dashboard, and cancels", async ({ page, users }) => {
    const owner = await users.create({ roles: ["ORGANIZER"] });
    const e = await seedEvent(owner.id, { capacity: 10 });
    const p = await users.create({ fullName: "Priya Participant" });

    await uiLogin(page, p, `/events/${e.slug}`);
    await expect(page).toHaveURL(new RegExp(`/events/${e.slug}$`));
    await page.getByRole("button", { name: "Register for this event" }).click();
    await expect(page.getByText("You are registered. Your place is confirmed.")).toBeVisible();
    await expect(page.getByText("1 of 10 taken")).toBeVisible();

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Priya Participant");
    await expect(page.getByRole("link", { name: e.title }).first()).toBeVisible(); // in the list and in the deadlines
    await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upcoming deadlines" })).toBeVisible();

    await page.goto(`/events/${e.slug}`);
    await page.getByRole("button", { name: "Cancel my registration" }).click();
    await expect(page.getByRole("button", { name: "Register for this event" })).toBeVisible();
    const row = await db().registration.findUniqueOrThrow({ where: { eventId_userId: { eventId: e.id, userId: p.id } } });
    expect(row.status).toBe("CANCELLED");

    await page.goto("/dashboard");
    await page.getByText(/Cancelled registrations \(1\)/).click();
    await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
  });

  test("a full event offers the waiting list; cancelling a seat promotes the waiting person", async ({ page, request, users }) => {
    const owner = await users.create({ roles: ["ORGANIZER"] });
    const e = await seedEvent(owner.id, { capacity: 1 });
    const first = await users.create();
    const second = await users.create();
    expect((await post(request, `/api/v1/events/${e.id}/registrations`, undefined, await asUser(first))).status()).toBe(201);

    await uiLogin(page, second, `/events/${e.slug}`);
    await expect(page.getByText("This event is full.")).toBeVisible();
    await page.getByRole("button", { name: "Join the waiting list" }).click();
    await expect(page.getByText("You are on the waiting list.")).toBeVisible();

    const cancel = await request.delete(`/api/v1/events/${e.id}/registrations`, { headers: await asUser(first) });
    expect(cancel.status()).toBe(200);
    await page.reload();
    await expect(page.getByText("You are registered. Your place is confirmed.")).toBeVisible();
  });

  test("registration API: login required, idempotent, 404 for drafts and malformed ids, closed windows are refused with a reason", async ({ request, users }) => {
    const owner = await users.create({ roles: ["ORGANIZER"] });
    const p = await users.create();
    const open = await seedEvent(owner.id);
    const draft = await seedEvent(owner.id, { status: "DRAFT" });
    const closed = await seedEvent(owner.id, { registrationClosesAt: new Date(Date.now() - 1000), registrationOpensAt: new Date(Date.now() - 2 * DAY) });
    const headers = await asUser(p);

    expect((await post(request, `/api/v1/events/${open.id}/registrations`, undefined, JSON_HEADERS)).status()).toBe(401);
    expect((await post(request, `/api/v1/events/${open.id}/registrations`, undefined, headers)).status()).toBe(201);
    expect((await post(request, `/api/v1/events/${open.id}/registrations`, undefined, headers)).status()).toBe(200);
    expect(await db().registration.count({ where: { eventId: open.id } })).toBe(1);
    expect((await post(request, `/api/v1/events/${draft.id}/registrations`, undefined, headers)).status()).toBe(404);
    expect((await post(request, `/api/v1/events/not-a-uuid/registrations`, undefined, headers)).status()).toBe(404);
    const refused = await post(request, `/api/v1/events/${closed.id}/registrations`, undefined, headers);
    expect(refused.status()).toBe(409);
    expect((await refused.json()).error.code).toBe("registration_closed");

    // my registrations: only mine
    const mine = await (await request.get("/api/v1/me/registrations", { headers })).json();
    expect(mine.items.map((i: { event: { id: string } }) => i.event.id)).toEqual([open.id]);
    expect((await request.get("/api/v1/me/registrations")).status()).toBe(401);
    // CSRF: a cross-origin registration attempt is refused even with a valid session
    const forged = await request.post(`/api/v1/events/${closed.id}/registrations`, { headers: { ...headers, Origin: "https://evil.example" } });
    expect(forged.status()).toBe(403);
  });
});

test.describe("organizer dashboard and event management", () => {
  test("an organizer creates a draft through the form, publishes it, manages registration, and sees participants", async ({ page, users }) => {
    const org = await users.create({ roles: ["ORGANIZER"], fullName: "Olga Organizer" });
    const p = await users.create({ fullName: "Pat Participant" });
    const title = `Created In The UI ${tag()}`;

    await uiLogin(page, org, "/organizer");
    await expect(page.getByRole("heading", { level: 1, name: "Organizer dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No events yet" })).toBeVisible();
    await page.getByRole("link", { name: "Create event" }).first().click();

    // validation messages come from the server and sit on the fields
    await page.getByRole("button", { name: "Create draft event" }).click();
    await expect(page.getByText("The title must be at least 3 characters.")).toBeVisible();

    const year = new Date().getUTCFullYear() + 2;
    await page.getByLabel(/^Title/).fill(title);
    await page.getByLabel(/^Category/).selectOption("AI_ML");
    await page.getByLabel(/^Summary/).fill("An end to end event created through the form.");
    await page.getByLabel(/^Description/).fill("A description that is clearly longer than twenty characters.");
    await page.getByLabel(/^Registration opens/).fill(`${year}-01-01T09:00`);
    await page.getByLabel(/^Registration closes/).fill(`${year}-02-01T09:00`);
    await page.getByLabel(/^Event starts/).fill(`${year}-02-10T09:00`);
    await page.getByLabel(/^Event ends/).fill(`${year}-02-09T09:00`); // wrong on purpose
    await page.getByLabel(/^Capacity/).fill("2");
    await page.getByRole("button", { name: "Create draft event" }).click();
    await expect(page.getByText("The event must end after it starts.")).toBeVisible();
    await page.getByLabel(/^Event ends/).fill(`${year}-02-11T09:00`);
    await page.getByRole("button", { name: "Create draft event" }).click();

    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    const created = await db().event.findFirstOrThrow({ where: { title } });
    expect(created.status).toBe("DRAFT");
    expect(created.createdById).toBe(org.id);
    expect((await db().eventOrganizer.findMany({ where: { eventId: created.id } })).map((o) => o.userId)).toEqual([org.id]);
    await page.goto(`/events/${created.slug}`); // invisible while a draft
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await page.goBack();

    await page.getByRole("button", { name: "Publish event" }).click();
    await expect(page.getByRole("link", { name: "View public page" })).toBeVisible();
    expect((await db().event.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("PUBLISHED");

    // a participant registers; the organizer sees the name and email, and the access is recorded
    await db().registration.create({ data: { eventId: created.id, userId: p.id, status: "CONFIRMED" } });
    await page.reload();
    await expect(page.getByRole("cell", { name: p.email })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "Pat Participant" })).toBeVisible();
    expect(await db().auditLog.count({ where: { entityId: created.id, action: "registration.list_viewed", actorId: org.id } })).toBeGreaterThan(0);

    // edit: lowering capacity below the confirmed count is refused with a clear message, a valid change is saved
    await page.getByLabel(/^Capacity/).fill("0");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Capacity must be at least 1.")).toBeVisible();
    await page.getByLabel(/^Capacity/).fill("5");
    await page.getByLabel(/^Summary/).fill("The summary was edited by the organizer.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Event saved.")).toBeVisible();
    expect((await db().event.findUniqueOrThrow({ where: { id: created.id } })).capacity).toBe(5);

    await page.getByRole("button", { name: "Close registration" }).click();
    await expect(page.getByRole("button", { name: "Reopen registration" })).toBeVisible();
    await page.goto("/organizer");
    await expect(page.getByRole("link", { name: title })).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("participants and organizers of other events cannot reach or change an event", async ({ page, request, users }) => {
    const owner = await users.create({ roles: ["ORGANIZER"] });
    const other = await users.create({ roles: ["ORGANIZER"] });
    const p = await users.create();
    const pub = await seedEvent(owner.id);
    const draft = await seedEvent(owner.id, { status: "DRAFT" });
    const [asOwner, asOther, asParticipant] = await Promise.all([asUser(owner), asUser(other), asUser(p)]);
    const patch = (id: string, headers: Record<string, string>) => request.patch(`/api/v1/events/${id}`, { headers, data: { title: "Hijacked by someone" } });
    const status = (id: string, headers: Record<string, string>, action = "cancel") => post(request, `/api/v1/events/${id}/status`, { action }, headers);

    // anonymous
    expect((await post(request, "/api/v1/events", {}, JSON_HEADERS)).status()).toBe(401);
    expect((await patch(pub.id, JSON_HEADERS)).status()).toBe(401);
    expect((await request.get(`/api/v1/events/${pub.id}/registrations`)).status()).toBe(401);

    // participant
    expect((await post(request, "/api/v1/events", {}, asParticipant)).status()).toBe(403);
    expect((await patch(pub.id, asParticipant)).status()).toBe(403);
    expect((await status(pub.id, asParticipant)).status()).toBe(403);
    expect((await request.get(`/api/v1/events/${pub.id}/registrations`, { headers: asParticipant })).status()).toBe(403);

    // an organizer of a different event
    expect((await patch(pub.id, asOther)).status()).toBe(403);
    expect((await status(pub.id, asOther, "archive")).status()).toBe(403);
    expect((await request.get(`/api/v1/events/${pub.id}/registrations`, { headers: asOther })).status()).toBe(403);
    expect((await patch(draft.id, asOther)).status()).toBe(404); // someone else's draft does not exist for them
    expect((await status(draft.id, asOther, "publish")).status()).toBe(404);
    expect((await request.get(`/api/v1/events/${draft.id}`, { headers: asOther })).status()).toBe(404);

    // nothing changed
    const after = await db().event.findMany({ where: { id: { in: [pub.id, draft.id] } }, select: { id: true, title: true, status: true } });
    expect(after.find((a) => a.id === pub.id)).toMatchObject({ title: pub.title, status: "PUBLISHED" });
    expect(after.find((a) => a.id === draft.id)).toMatchObject({ title: draft.title, status: "DRAFT" });

    // the owner can do all of it
    expect((await request.get(`/api/v1/events/${draft.id}`, { headers: asOwner })).status()).toBe(200);
    expect((await request.patch(`/api/v1/events/${pub.id}`, { headers: asOwner, data: { title: "Renamed by owner" } })).status()).toBe(200);

    // pages: the organizer area shows access denied to a participant, and a foreign event page is not found
    await uiLogin(page, p, "/organizer");
    await expect(page.getByRole("heading", { name: /You do not have access to the organizer dashboard/ })).toBeVisible();
    await page.goto("/organizer/events/new");
    await expect(page.getByRole("heading", { name: /You do not have access to event creation/ })).toBeVisible();
    await page.goto(`/organizer/events/${pub.id}`);
    await expect(page.getByRole("heading", { name: /You do not have access to this event/ })).toBeVisible();
    await expect(page.getByText(p.email)).toHaveCount(0); // never a participant table or anyone's email
  });

  test("an organizer cannot open another organizer's event page, and creation cannot smuggle in status, slug or owner", async ({ page, request, users }) => {
    const owner = await users.create({ roles: ["ORGANIZER"] });
    const other = await users.create({ roles: ["ORGANIZER"] });
    const ev = await seedEvent(owner.id);
    await uiLogin(page, other, `/organizer/events/${ev.id}`);
    await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
    await page.goto(`/organizer/events/${randomUUID()}`);
    await expect(page.getByText("This page could not be found.")).toBeVisible();

    const year = new Date().getUTCFullYear() + 2;
    const body = {
      title: `Smuggled ${tag()}`, category: "WORKSHOP", summary: "A summary that is long enough.", description: "A description that is long enough to pass.",
      registrationOpensAt: `${year}-01-01T00:00:00.000Z`, registrationClosesAt: `${year}-02-01T00:00:00.000Z`, startsAt: `${year}-02-10T00:00:00.000Z`, endsAt: `${year}-02-11T00:00:00.000Z`,
      status: "PUBLISHED", slug: "evil-slug", createdById: owner.id, registrationMode: "TEAM", capacity: 3,
    };
    const res = await post(request, "/api/v1/events", body, await asUser(other));
    expect(res.status()).toBe(201);
    const made = await db().event.findUniqueOrThrow({ where: { id: (await res.json()).id }, include: { organizers: true } });
    expect(made).toMatchObject({ status: "DRAFT", registrationMode: "INDIVIDUAL", createdById: other.id });
    expect(made.slug).not.toBe("evil-slug");
    expect(made.organizers.map((o) => o.userId)).toEqual([other.id]);
    // invalid timeline -> 400 with the field named
    const bad = await post(request, "/api/v1/events", { ...body, endsAt: `${year}-02-09T00:00:00.000Z` }, await asUser(other));
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error.issues).toEqual([{ path: ["endsAt"], message: "The event must end after it starts." }]);
  });

  test("role-aware navigation: organizers see the organizer dashboard link, participants do not", async ({ page, users }) => {
    const org = await users.create({ roles: ["ORGANIZER"] });
    const p = await users.create();
    await uiLogin(page, p, "/dashboard");
    await expect(page.getByRole("navigation", { name: "Account areas" }).getByRole("link", { name: "My dashboard" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "Account areas" }).getByRole("link", { name: "Organizer dashboard" })).toHaveCount(0);
    await page.context().clearCookies();
    await uiLogin(page, org, "/dashboard");
    await expect(page.getByRole("navigation", { name: "Account areas" }).getByRole("link", { name: "Organizer dashboard" })).toBeVisible();
  });
});

test.describe("account settings", () => {
  test("profile can be edited and shows on the dashboard; the email is read-only", async ({ page, users }) => {
    const u = await users.create({ fullName: "Old Name" });
    await uiLogin(page, u, "/dashboard/settings");
    await page.getByLabel(/^Full name/).fill("New Name");
    await page.getByLabel(/^Short bio/).fill("I build things.");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, New Name");
    expect(await db().user.findUniqueOrThrow({ where: { id: u.id } })).toMatchObject({ fullName: "New Name", bio: "I build things." });
  });

  test("profile API ignores attempts to change email, roles or another user's profile", async ({ request, users }) => {
    const a = await users.create({ fullName: "Alice A" });
    const b = await users.create({ fullName: "Bob B" });
    const res = await request.patch("/api/v1/me/profile", { headers: await asUser(a), data: { fullName: "Alice Changed", email: "x@example.test", roles: ["ADMIN"], id: b.id } });
    expect(res.status()).toBe(200);
    expect((await db().user.findUniqueOrThrow({ where: { id: b.id } })).fullName).toBe("Bob B");
    const after = await db().user.findUniqueOrThrow({ where: { id: a.id }, include: { roles: true } });
    expect(after.fullName).toBe("Alice Changed");
    expect(after.email).toBe(a.email);
    expect(after.roles.map((r) => r.role)).toEqual(["PARTICIPANT"]);
    expect((await request.patch("/api/v1/me/profile", { headers: await asUser(a), data: { fullName: "x" } })).status()).toBe(400);
    expect((await request.patch("/api/v1/me/profile", { headers: JSON_HEADERS, data: { fullName: "Nope Nope" } })).status()).toBe(401);
  });

  test("change password: needs the current password, enforces the policy, signs out other devices, keeps this one", async ({ page, request, users }) => {
    const u = await users.create();
    await uiLogin(page, u, "/dashboard/settings");
    await page.getByLabel(/^Current password/).fill("definitely the wrong one");
    await page.getByLabel(/^New password/).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Your current password is not correct.")).toBeVisible();
    await page.getByLabel(/^Current password/).fill(PASSWORD);
    await page.getByLabel(/^New password/).fill("short");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
    await page.getByLabel(/^New password/).fill(PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Choose a password different from your current one.")).toBeVisible();

    // another device is signed in
    const other = await createRawSession(u.id);
    expect((await request.get("/api/v1/auth/me", { headers: { Cookie: `${COOKIE}=${other}` } })).status()).toBe(200);

    await page.getByLabel(/^New password/).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Password changed. Your other devices were signed out.")).toBeVisible();

    expect((await request.get("/api/v1/auth/me", { headers: { Cookie: `${COOKIE}=${other}` } })).status()).toBe(401);
    await page.goto("/dashboard"); // this browser got a fresh session
    await expect(page).toHaveURL(/\/dashboard$/);
    const login = async (password: string) => (await post(request, "/api/v1/auth/login", { email: u.email, password })).status();
    expect(await login(PASSWORD)).toBe(401);
    expect(await login(NEW_PASSWORD)).toBe(200);
    expect(await db().auditLog.count({ where: { actorId: u.id, action: "auth.password_changed" } })).toBe(1);
  });

  test("change password API: requires a session and Origin, and the current password", async ({ request, users }) => {
    const u = await users.create();
    expect((await post(request, "/api/v1/auth/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, JSON_HEADERS)).status()).toBe(401);
    const headers = await asUser(u);
    expect((await post(request, "/api/v1/auth/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { ...headers, Origin: "https://evil.example" })).status()).toBe(403);
    const wrong = await post(request, "/api/v1/auth/change-password", { currentPassword: "nope nope nope", newPassword: NEW_PASSWORD }, headers);
    expect(wrong.status()).toBe(400);
    expect((await wrong.json()).error.code).toBe("invalid_current_password");
  });
});

async function axeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
}

test.describe("accessibility of event and dashboard pages", () => {
  for (const vp of [{ name: "mobile", width: 360, height: 800 }, { name: "desktop", width: 1440, height: 900 }]) {
    test(`${vp.name}: events, details, dashboards and forms have no WCAG 2.2 AA violations or overflow`, async ({ page, users }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const noOverflow = async (label: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${label} overflow`).toBeLessThanOrEqual(0);

      const org = await users.create({ roles: ["ORGANIZER"], fullName: "Axe Organizer" });
      const e = await seedEvent(org.id, { capacity: 3 });
      const draft = await seedEvent(org.id, { status: "DRAFT" });
      await db().registration.create({ data: { eventId: e.id, userId: org.id, status: "CONFIRMED" } });

      for (const path of ["/events", `/events/${e.slug}`, `/events?q=zzzz-none-${tag()}`]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await axeClean(page, path);
        await noOverflow(path);
      }
      await uiLogin(page, org, "/dashboard");
      await expect(page).toHaveURL(/\/dashboard$/);
      for (const path of ["/dashboard", "/dashboard/settings", "/organizer", "/organizer/events/new", `/organizer/events/${e.id}`, `/organizer/events/${draft.id}`, `/events/${e.slug}`]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await axeClean(page, path);
        await noOverflow(path);
      }
      // the create form with errors
      await page.goto("/organizer/events/new");
      await page.getByRole("button", { name: "Create draft event" }).click();
      await expect(alertOf(page).first()).toBeVisible();
      await axeClean(page, "create event with errors");
    });
  }
});
