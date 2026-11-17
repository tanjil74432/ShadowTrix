import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eligibleTemplates, type EligibilityFacts } from "@/lib/banner/eligibility";
import { FRAME, PANEL, identityWords, planPanel } from "@/lib/banner/render";
import { TEMPLATES, TEMPLATE_IDS } from "@/lib/banner/templates";
import { getDb } from "@/server/db/client";
import { getOwnBannerSubject } from "@/server/modules/organization/banner.service";
import { cleanup, createUser } from "./helpers/auth-harness";

const none: EligibilityFacts = { designations: [], roles: [], organizesAnEvent: false, judgesAnEvent: false, isVerifiedMember: false, isOnATeam: false };

describe("which templates a person may be offered", () => {
  it("everyone gets the participant template and nothing that claims a role", () => {
    expect(eligibleTemplates(none)).toEqual(["participant"]);
    expect(eligibleTemplates({ ...none, roles: ["PARTICIPANT", "TEAM_LEADER"] })).toEqual(["participant"]);
  });

  it("founder and co-founder need an approved position with that title, and never both from one title", () => {
    expect(eligibleTemplates({ ...none, designations: ["Founder"] })).toEqual(["founder", "participant"]);
    expect(eligibleTemplates({ ...none, designations: ["Co-Founder & CTO"] })).toEqual(["co-founder", "participant"]);
    expect(eligibleTemplates({ ...none, designations: ["Cofounder"] })).toEqual(["co-founder", "participant"]);
    expect(eligibleTemplates({ ...none, designations: ["Founder", "Co-Founder"] })).toEqual(["founder", "co-founder", "participant"]);
    expect(eligibleTemplates({ ...none, designations: ["Foundation Lead", "Founding Engineer"] })).toEqual(["participant"]);
  });

  it("organizer needs an organizer role, an event assignment or an approved organizer position", () => {
    expect(eligibleTemplates({ ...none, roles: ["ORGANIZER"] })).toContain("organizer");
    expect(eligibleTemplates({ ...none, organizesAnEvent: true })).toContain("organizer");
    expect(eligibleTemplates({ ...none, designations: ["Lead Organiser"] })).toContain("organizer");
    expect(eligibleTemplates({ ...none, roles: ["JUDGE", "ADMIN"] })).not.toContain("organizer"); // an administrator is not automatically an organizer
  });

  it("judge needs a judge role or an assignment; team member needs a verified membership or a team", () => {
    expect(eligibleTemplates({ ...none, roles: ["JUDGE"] })).toContain("judge");
    expect(eligibleTemplates({ ...none, judgesAnEvent: true })).toContain("judge");
    expect(eligibleTemplates({ ...none, roles: ["ORGANIZER"] })).not.toContain("judge");
    expect(eligibleTemplates({ ...none, isVerifiedMember: true })).toContain("team-member");
    expect(eligibleTemplates({ ...none, isOnATeam: true })).toContain("team-member");
    expect(eligibleTemplates(none)).not.toContain("team-member");
  });

  it("the result is ordered, de-duplicated and only contains known templates", () => {
    const all = eligibleTemplates({ designations: ["Founder", "Co-Founder", "Organizer"], roles: ["ORGANIZER", "JUDGE"], organizesAnEvent: true, judgesAnEvent: true, isVerifiedMember: true, isOnATeam: true });
    expect(all).toEqual([...TEMPLATE_IDS]);
  });
});

describe("template definitions", () => {
  it("has the six templates, each with a distinct badge and only brand colours", () => {
    expect(TEMPLATE_IDS).toHaveLength(6);
    expect(new Set(TEMPLATE_IDS.map((id) => TEMPLATES[id].badge)).size).toBe(6);
    const brand = new Set(["#090909", "#141414", "#1c1c1c", "#303030", "#f5f5f5", "#a3a3a3", "#f07832", "#d95f1b", "#ff9a55"]);
    for (const id of TEMPLATE_IDS) {
      expect(TEMPLATES[id].id).toBe(id);
      expect(brand.has(TEMPLATES[id].accent)).toBe(true);
      expect(brand.has(TEMPLATES[id].accentSoft)).toBe(true);
    }
  });

  it("the background identity text follows the person, role, event and organization, and is bounded", () => {
    expect(identityWords({ template: "judge", name: "Ada Lovelace", event: "Spring Hackathon", organization: "Team EU Shadow" })).toEqual(["SHADOWTRIX", "JUDGE", "ADA LOVELACE", "SPRING HACKATHON", "TEAM EU SHADOW"]);
    expect(identityWords({ template: "participant", name: "  ", organization: "Team EU Shadow" })).toEqual(["SHADOWTRIX", "PARTICIPANT", "", "TEAM EU SHADOW"].filter(Boolean));
    const long = identityWords({ template: "founder", name: "X".repeat(200), organization: "Y" });
    expect(long.every((w) => w.length <= 28)).toBe(true);
  });
});

/** A measuring context that behaves like a proportional font: width grows with text length and font size. */
function fakeContext() {
  const ctx = {
    font: "",
    measureText(text: string) {
      const px = Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 16);
      return { width: text.length * px * 0.56 };
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

describe("information panel layout never overlaps, whatever is typed", () => {
  const long = "Priyanka Wickramasinghe-Balasubramaniam Longname Of The Extremely Long Variety";
  const cases = [
    { name: "Ada", designation: undefined, event: undefined, tagline: undefined },
    { name: long, designation: "President of the Executive Committee and Head of Everything", event: "ShadowTrix International Spring Hackathon and Datathon 2026 Finals", tagline: "Building things that matter, one commit at a time, together with the whole ShadowTrix community." },
    { name: "A".repeat(60), designation: "D".repeat(80), event: "E".repeat(80), tagline: "T".repeat(90) },
    { name: "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW", designation: "Co-Founder", event: "Hack", tagline: "Hi" },
  ];
  for (const [i, c] of cases.entries()) {
    it(`case ${i + 1}: every block sits inside the panel and above the tagline`, () => {
      const plan = planPanel(fakeContext(), c, "sans-serif");
      expect(plan.name.lines.length).toBeLessThanOrEqual(2);
      expect(plan.name.baseline).toBeGreaterThan(PANEL.y);
      expect(plan.contentBottom).toBeLessThanOrEqual(plan.taglineTop);
      expect(plan.contentBottom).toBeLessThan(PANEL.y + PANEL.h);
      if (plan.tagline) expect(plan.tagline.baseline + plan.tagline.lines.length * 0).toBeLessThanOrEqual(PANEL.y + PANEL.h - 20);
      if (plan.designation) expect(plan.designation.lines).toHaveLength(1);
      if (plan.event) expect(plan.event.lines.length).toBeLessThanOrEqual(2);
    });
  }

  it("the portrait frame and the panel tile the artwork without overlapping", () => {
    expect(FRAME.y + FRAME.h).toBeLessThanOrEqual(PANEL.y);
    expect(FRAME.x).toBe(PANEL.x);
    expect(FRAME.w).toBe(PANEL.w);
    expect(PANEL.y + PANEL.h).toBeLessThanOrEqual(1350);
  });
});

describe("banner data uses only real records", () => {
  const events: string[] = [];
  afterEach(async () => {
    await getDb().event.deleteMany({ where: { id: { in: events.splice(0) } } });
    await cleanup();
  });

  const event = async (createdById: string, status: "DRAFT" | "PUBLISHED" | "CANCELLED", title: string) => {
    const e = await getDb().event.create({
      data: { slug: `bt-${randomUUID().slice(0, 8)}`, title, category: "HACKATHON", summary: "s", description: "d", createdById, status, startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 2 * 86_400_000), registrationOpensAt: new Date(Date.now() - 86_400_000), registrationClosesAt: new Date(Date.now() + 43_200_000) },
    });
    events.push(e.id);
    return e;
  };

  it("an ordinary account sees participant only and no events", async () => {
    const u = await createUser();
    const s = await getOwnBannerSubject({ id: u.id, fullName: u.fullName });
    expect(s.templates).toEqual(["participant"]);
    expect(s.events).toEqual([]);
  });

  it("an organizer assignment unlocks the organizer template and that event only; a cancelled event is not offered", async () => {
    const u = await createUser({ roles: ["ORGANIZER"] });
    const live = await event(u.id, "PUBLISHED", "BT Live Event");
    const dead = await event(u.id, "CANCELLED", "BT Cancelled Event");
    await getDb().eventOrganizer.createMany({ data: [{ eventId: live.id, userId: u.id, isLead: true }, { eventId: dead.id, userId: u.id }] });
    const s = await getOwnBannerSubject({ id: u.id, fullName: u.fullName });
    expect(s.templates).toEqual(["organizer", "participant"]);
    expect(s.events.map((e) => e.title)).toEqual(["BT Live Event"]);
  });

  it("a judge role unlocks the judge template; someone else's events never appear", async () => {
    const judge = await createUser({ roles: ["JUDGE"] });
    const other = await createUser();
    const theirs = await event(other.id, "PUBLISHED", "BT Not Mine");
    await getDb().judgeAssignment.create({ data: { eventId: theirs.id, judgeId: other.id } });
    const s = await getOwnBannerSubject({ id: judge.id, fullName: judge.fullName });
    expect(s.templates).toEqual(["participant", "judge"]);
    expect(s.events).toEqual([]);
  });

  it("a confirmed registration offers that event, a pending one does not", async () => {
    const u = await createUser();
    const a = await event(u.id, "PUBLISHED", "BT Confirmed");
    const b = await event(u.id, "PUBLISHED", "BT Pending");
    await getDb().registration.createMany({ data: [{ eventId: a.id, userId: u.id, status: "CONFIRMED" }, { eventId: b.id, userId: u.id, status: "PENDING" }] });
    const s = await getOwnBannerSubject({ id: u.id, fullName: u.fullName });
    expect(s.events.map((e) => e.title)).toEqual(["BT Confirmed"]);
  });
});
