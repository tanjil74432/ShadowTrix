import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { registerForEvent } from "@/server/modules/events/registrations.service";
import { updateEvent } from "@/server/modules/events/events.service";
import { hashToken } from "@/server/security/tokens";
import {
  cancelTeamRegistration, createTeam, disbandTeam, getTeamForMember, inviteMember, leaveTeam, listMyInvitations, previewInvitation,
  registerTeam, removeMember, respondToInvitation, revokeInvitation, updateTeam,
} from "@/server/modules/teams/teams.service";
import { createTeamSchema, inviteSchema } from "@/server/modules/teams/teams.schema";
import { cleanup, makeHarness, tokenFrom } from "./helpers/auth-harness";
import { DAY, iso, organizer, participant, publishedEvent, teamEvent } from "./helpers/event-fixtures";

afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await getDb().$disconnect();
});

let n = 0;
const teamName = () => `vt team ${Date.now().toString(36)}${n++}`;

/** A leader with a team of the given size (members joined through real invitations). */
async function teamWith(eventId: string, size: number, h = makeHarness()) {
  const leader = await participant();
  const team = await createTeam(leader.actor, eventId, createTeamSchema.parse({ name: teamName() }), h.now());
  const members = [leader];
  for (let i = 1; i < size; i++) {
    const m = await participant();
    await inviteMember(leader.actor, team.id, m.u.email, h.deps);
    await h.flush();
    await respondToInvitation(m.actor, { token: tokenFrom(h.lastMailTo(m.u.email)) }, true, h.now());
    members.push(m);
  }
  return { leader, team, members, h };
}

describe("team input", () => {
  it("validates names, descriptions and invitation emails", () => {
    expect(createTeamSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(createTeamSchema.safeParse({ name: "<script>" }).success).toBe(false);
    expect(createTeamSchema.safeParse({ name: "x".repeat(61) }).success).toBe(false);
    expect(createTeamSchema.parse({ name: "  Night Owls ", description: "" })).toEqual({ name: "Night Owls", description: null });
    expect(inviteSchema.parse({ email: "  Pat@Example.COM " }).email).toBe("pat@example.com");
    expect(inviteSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("creating and editing teams", () => {
  it("creates a team with the creator as its only leader, for team events only", async () => {
    const o = await organizer();
    const e = await teamEvent(o);
    const p = await participant();
    const team = await createTeam(p.actor, e.id, createTeamSchema.parse({ name: teamName(), description: "We build things" }));
    const view = await getTeamForMember(p.actor, team.id);
    expect(view).toMatchObject({ isLeader: true, status: "ACTIVE", description: "We build things" });
    expect(view.members.map((m) => m.role)).toEqual(["LEADER"]);
    expect(JSON.stringify(view)).not.toContain(p.u.email); // member emails are never exposed

    const individual = await publishedEvent(o);
    await expect(createTeam(p.actor, individual.id, createTeamSchema.parse({ name: teamName() }))).rejects.toMatchObject({ code: "not_a_team_event" });
  });

  it("refuses a second team in the same event, duplicate names, unpublished and closed events", async () => {
    const o = await organizer();
    const e = await teamEvent(o);
    const a = await participant();
    const b = await participant();
    const name = teamName();
    await createTeam(a.actor, e.id, createTeamSchema.parse({ name }));
    await expect(createTeam(a.actor, e.id, createTeamSchema.parse({ name: teamName() }))).rejects.toMatchObject({ code: "already_in_team" });
    await expect(createTeam(b.actor, e.id, createTeamSchema.parse({ name }))).rejects.toMatchObject({ code: "team_name_taken" });
    const closed = await teamEvent(o);
    await getDb().event.update({ where: { id: closed.id }, data: { registrationClosesAt: new Date(Date.now() - 1000), registrationOpensAt: new Date(Date.now() - 3 * DAY) } });
    await expect(createTeam(b.actor, closed.id, createTeamSchema.parse({ name: teamName() }))).rejects.toMatchObject({ code: "team_closed" });
    await expect(createTeam(b.actor, "00000000-0000-4000-8000-000000000000", createTeamSchema.parse({ name: teamName() }))).rejects.toMatchObject({ status: 404 });
  });

  it("only the leader edits; non-members cannot even see the team", async () => {
    const o = await organizer();
    const e = await teamEvent(o);
    const { leader, team, members } = await teamWith(e.id, 2);
    const stranger = await participant();
    await expect(updateTeam(members[1].actor, team.id, { description: "hijack" })).rejects.toMatchObject({ status: 403 });
    await expect(updateTeam(stranger.actor, team.id, { description: "hijack" })).rejects.toMatchObject({ status: 404 });
    await expect(getTeamForMember(stranger.actor, team.id)).rejects.toMatchObject({ status: 404 });
    await expect(updateTeam(leader.actor, team.id, { description: "Edited by leader" })).resolves.toMatchObject({ description: "Edited by leader" });
  });
});

describe("invitations", () => {
  it("emails a single-use link; only the invited person (matching email) can accept; replays fail", async () => {
    const o = await organizer();
    const e = await teamEvent(o);
    const h = makeHarness();
    const leader = await participant();
    const team = await createTeam(leader.actor, e.id, createTeamSchema.parse({ name: teamName() }));
    const invitee = await participant();
    const other = await participant();
    await inviteMember(leader.actor, team.id, invitee.u.email, h.deps);
    await h.flush();
    const mail = h.lastMailTo(invitee.u.email)!;
    expect(mail.subject).toMatch(/invited you to join a team/);
    const token = tokenFrom(mail);
    const stored = await getDb().teamInvitation.findFirstOrThrow({ where: { teamId: team.id } });
    expect(stored.tokenHash).toBe(hashToken(token));
    expect(stored.tokenHash).not.toBe(token);

    expect(await previewInvitation(other.actor, token)).toBeNull(); // somebody else's invitation looks like nothing
    expect(await previewInvitation(invitee.actor, token)).toMatchObject({ teamName: team.name, status: "PENDING", expired: false });
    await expect(respondToInvitation(other.actor, { token }, true)).rejects.toMatchObject({ code: "invalid_invitation" });
    expect(await getDb().teamMember.count({ where: { teamId: team.id } })).toBe(1);

    await expect(respondToInvitation(invitee.actor, { token }, true)).resolves.toMatchObject({ joined: true });
    await expect(respondToInvitation(invitee.actor, { token }, true)).rejects.toMatchObject({ code: "invalid_invitation" }); // replay
    await expect(respondToInvitation(invitee.actor, { token }, false)).rejects.toMatchObject({ code: "invalid_invitation" });
    expect(await getDb().teamMember.count({ where: { teamId: team.id } })).toBe(2);
  });

  it("declining leaves the team unchanged and cannot be reversed by replay", async () => {
    const o = await organizer();
    const e = await teamEvent(o);
    const h = makeHarness();
    const { leader, team } = await teamWith(e.id, 1, h);
    const invitee = await participant();
    await inviteMember(leader.actor, team.id, invitee.u.email, h.deps);
    await h.flush();
    const token = tokenFrom(h.lastMailTo(invitee.u.email));
    expect(await respondToInvitation(invitee.actor, { token }, false)).toMatchObject({ joined: false });
    await expect(respondToInvitation(invitee.actor, { token }, true)).rejects.toMatchObject({ code: "invalid_invitation" });
    expect(await getDb().teamMember.count({ where: { teamId: team.id } })).toBe(1);
    // and the leader can invite the same person again afterwards
    await expect(inviteMember(leader.actor, team.id, invitee.u.email, h.deps)).resolves.toBeDefined();
  });

  it("expires after 7 days, and an expired invitation does not block a new one", async () => {
    const o = await organizer();
    const e = await teamEvent(o, { registrationClosesAt: iso(20), startsAt: iso(25), endsAt: iso(26) });
    const h = makeHarness();
    const { leader, team } = await teamWith(e.id, 1, h);
    const invitee = await participant();
    await inviteMember(leader.actor, team.id, invitee.u.email, h.deps);
    await h.flush();
    const token = tokenFrom(h.lastMailTo(invitee.u.email));
    h.advance(7 * DAY + 1000);
    expect(await previewInvitation(invitee.actor, token, h.now())).toMatchObject({ expired: true });
    expect(await listMyInvitations(invitee.actor, h.now())).toHaveLength(0);
    await expect(respondToInvitation(invitee.actor, { token }, true, h.now())).rejects.toMatchObject({ code: "invalid_invitation" });
    await expect(inviteMember(leader.actor, team.id, invitee.u.email, h.deps)).resolves.toBeDefined();
  });

  it("the dashboard path (by id) works for the invited person only", async () => {
    const o = await organizer();
    const e = await teamEvent(o);
    const h = makeHarness();
    const { leader, team } = await teamWith(e.id, 1, h);
    const invitee = await participant();
    const other = await participant();
    await inviteMember(leader.actor, team.id, invitee.u.email, h.deps);
    const [mine] = await listMyInvitations(invitee.actor);
    expect(mine.team.name).toBe(team.name);
    expect(await listMyInvitations(other.actor)).toHaveLength(0);
    await expect(respondToInvitation(other.actor, { id: mine.id }, true)).rejects.toMatchObject({ code: "invalid_invitation" });
    await expect(respondToInvitation(invitee.actor, { id: mine.id }, true)).resolves.toMatchObject({ joined: true });
  });

  it("only the leader invites; duplicates, existing members and over-size teams are refused", async () => {
    const o = await organizer();
    const e = await teamEvent(o, { maxTeamSize: 4 });
    const h = makeHarness();
    const { leader, team, members } = await teamWith(e.id, 2, h);
    const [a, b, c] = [await participant(), await participant(), await participant()];
    await expect(inviteMember(members[1].actor, team.id, a.u.email, h.deps)).rejects.toMatchObject({ status: 403 });
    await expect(inviteMember((await participant()).actor, team.id, a.u.email, h.deps)).rejects.toMatchObject({ status: 404 });
    await expect(inviteMember(leader.actor, team.id, members[1].u.email, h.deps)).rejects.toMatchObject({ code: "already_member" });
    await inviteMember(leader.actor, team.id, a.u.email, h.deps);
    await expect(inviteMember(leader.actor, team.id, a.u.email, h.deps)).rejects.toMatchObject({ code: "already_invited" });
    await inviteMember(leader.actor, team.id, b.u.email, h.deps);
    // 2 members + 2 open invitations = the maximum of 4
    await expect(inviteMember(leader.actor, team.id, c.u.email, h.deps)).rejects.toMatchObject({ code: "team_full" });
  });

  it("the leader can revoke an open invitation, which then cannot be accepted", async () => {
    const o = await organizer();
    const e = await teamEvent(o);
    const h = makeHarness();
    const { leader, team } = await teamWith(e.id, 1, h);
    const invitee = await participant();
    const { id } = await inviteMember(leader.actor, team.id, invitee.u.email, h.deps);
    await h.flush();
    await revokeInvitation(leader.actor, team.id, id);
    await expect(respondToInvitation(invitee.actor, { token: tokenFrom(h.lastMailTo(invitee.u.email)) }, true)).rejects.toMatchObject({ code: "invalid_invitation" });
    await expect(revokeInvitation(leader.actor, team.id, id)).rejects.toMatchObject({ status: 404 });
  });

  it("accepting while already in another team of the event is refused and leaves the invitation open", async () => {
    const o = await organizer();
    const e = await teamEvent(o);
    const h = makeHarness();
    const t1 = await teamWith(e.id, 1, h);
    const t2 = await teamWith(e.id, 1, h);
    const person = await participant();
    await inviteMember(t1.leader.actor, t1.team.id, person.u.email, h.deps);
    await inviteMember(t2.leader.actor, t2.team.id, person.u.email, h.deps);
    await h.flush();
    const [first, second] = h.mailsTo(person.u.email).map((m) => tokenFrom(m));
    await respondToInvitation(person.actor, { token: first }, true);
    await expect(respondToInvitation(person.actor, { token: second }, true)).rejects.toMatchObject({ code: "already_in_team" });
    const inv = await getDb().teamInvitation.findFirstOrThrow({ where: { teamId: t2.team.id } });
    expect(inv.status).toBe("PENDING"); // the whole answer rolled back
  });

  it("concurrent accepts of the last places never exceed the team size (database trigger)", async () => {
    const o = await organizer();
    const e = await teamEvent(o, { maxTeamSize: 3 });
    const h = makeHarness();
    const { leader, team } = await teamWith(e.id, 1, h);
    const people = await Promise.all(Array.from({ length: 6 }, () => participant()));
    // invitations are sent in batches because open invitations count towards the limit; create them directly for the race
    for (const p of people) {
      await getDb().teamInvitation.create({ data: { teamId: team.id, inviterId: leader.u.id, inviteeEmail: p.u.email, tokenHash: hashToken(p.u.id), expiresAt: new Date(Date.now() + DAY) } });
    }
    const results = await Promise.allSettled(people.map((p) => respondToInvitation(p.actor, { token: p.u.id.padEnd(30, "x") }, true).catch(async () => respondToInvitationById(p))));
    void results;
    expect(await getDb().teamMember.count({ where: { teamId: team.id } })).toBe(3);
    expect(await getDb().teamInvitation.count({ where: { teamId: team.id, status: "ACCEPTED" } })).toBe(2);
  });

  it("the same invitation answered twice at the same moment succeeds once", async () => {
    const o = await organizer();
    const e = await teamEvent(o);
    const h = makeHarness();
    const { leader, team } = await teamWith(e.id, 1, h);
    const invitee = await participant();
    await inviteMember(leader.actor, team.id, invitee.u.email, h.deps);
    await h.flush();
    const token = tokenFrom(h.lastMailTo(invitee.u.email));
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => respondToInvitation(invitee.actor, { token }, true)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await getDb().teamMember.count({ where: { teamId: team.id } })).toBe(2);
  });
});

async function respondToInvitationById(p: Awaited<ReturnType<typeof participant>>) {
  const [inv] = await listMyInvitations(p.actor);
  return respondToInvitation(p.actor, { id: inv.id }, true);
}

describe("leaving, removing, disbanding", () => {
  it("members leave voluntarily; the leader cannot leave while others remain; the leader removes members", async () => {
    const o = await organizer();
    const e = await teamEvent(o);
    const { leader, team, members } = await teamWith(e.id, 3);
    await expect(leaveTeam(leader.actor, team.id)).rejects.toMatchObject({ code: "leader_cannot_leave" });
    await expect(removeMember(members[1].actor, team.id, members[2].u.id)).rejects.toMatchObject({ status: 403 });
    await expect(removeMember(leader.actor, team.id, leader.u.id)).rejects.toMatchObject({ code: "cannot_remove_leader" });
    await leaveTeam(members[1].actor, team.id);
    await removeMember(leader.actor, team.id, members[2].u.id);
    expect(await getDb().teamMember.count({ where: { teamId: team.id } })).toBe(1);
    // they are free again and can join or create another team
    await expect(createTeam(members[1].actor, e.id, createTeamSchema.parse({ name: teamName() }))).resolves.toBeDefined();
  });

  it("a sole leader leaving disbands the team; disbanding frees the name's members and revokes open invitations", async () => {
    const o = await organizer();
    const e = await teamEvent(o);
    const h = makeHarness();
    const solo = await teamWith(e.id, 1, h);
    await leaveTeam(solo.leader.actor, solo.team.id);
    expect((await getDb().team.findUniqueOrThrow({ where: { id: solo.team.id } })).status).toBe("DISBANDED");

    const t = await teamWith(e.id, 2, h);
    const invitee = await participant();
    await inviteMember(t.leader.actor, t.team.id, invitee.u.email, h.deps);
    await disbandTeam(t.leader.actor, t.team.id);
    expect(await getDb().teamMember.count({ where: { teamId: t.team.id } })).toBe(0);
    expect((await getDb().teamInvitation.findFirstOrThrow({ where: { teamId: t.team.id, inviteeEmail: invitee.u.email } })).status).toBe("REVOKED");
    await expect(disbandTeam(t.leader.actor, t.team.id)).rejects.toMatchObject({ status: 404 }); // no longer a member
  });
});

describe("team registration", () => {
  it("registers every member together once the team size is within the limits", async () => {
    const o = await organizer();
    const e = await teamEvent(o, { capacity: 5 });
    const solo = await teamWith(e.id, 1);
    await expect(registerTeam(solo.leader.actor, solo.team.id)).rejects.toMatchObject({ code: "team_size_invalid" }); // needs 2 to 3
    const { leader, team, members } = await teamWith(e.id, 2);
    expect(await registerTeam(leader.actor, team.id)).toEqual({ status: "CONFIRMED", created: true });
    expect(await registerTeam(leader.actor, team.id)).toEqual({ status: "CONFIRMED", created: false }); // idempotent
    const rows = await getDb().registration.findMany({ where: { teamId: team.id } });
    expect(rows.map((r) => r.userId).sort()).toEqual(members.map((m) => m.u.id).sort());
    expect(rows.every((r) => r.status === "CONFIRMED")).toBe(true);
    await expect(registerTeam(members[1].actor, team.id)).rejects.toMatchObject({ status: 403 }); // only the leader
  });

  it("individual registration is refused for team events, and team registration for individual events", async () => {
    const o = await organizer();
    const te = await teamEvent(o);
    const ie = await publishedEvent(o);
    const p = await participant();
    await expect(registerForEvent(p.actor, te.id)).rejects.toMatchObject({ code: "registration_team_only" });
    await expect(createTeam(p.actor, ie.id, createTeamSchema.parse({ name: teamName() }))).rejects.toMatchObject({ code: "not_a_team_event" });
  });

  it("capacity counts teams: the extra team waits and is promoted as a whole when a place frees up", async () => {
    const o = await organizer();
    const e = await teamEvent(o, { capacity: 1 });
    const a = await teamWith(e.id, 2);
    const b = await teamWith(e.id, 2);
    expect((await registerTeam(a.leader.actor, a.team.id, new Date(Date.now()))).status).toBe("CONFIRMED");
    expect((await registerTeam(b.leader.actor, b.team.id, new Date(Date.now() + 1000))).status).toBe("WAITLISTED");
    expect(await getDb().registration.count({ where: { eventId: e.id, status: "CONFIRMED" } })).toBe(2); // two PEOPLE, one team
    expect(await cancelTeamRegistration(a.leader.actor, a.team.id)).toEqual({ cancelled: true });
    expect(await getDb().registration.count({ where: { teamId: b.team.id, status: "CONFIRMED" } })).toBe(2);
    expect(await cancelTeamRegistration(a.leader.actor, a.team.id)).toEqual({ cancelled: false });
  });

  it("simultaneous registrations of many teams never exceed the team capacity", async () => {
    const o = await organizer();
    const e = await teamEvent(o, { capacity: 3 });
    const teams = await Promise.all(Array.from({ length: 7 }, () => teamWith(e.id, 2)));
    const results = await Promise.all(teams.map((t) => registerTeam(t.leader.actor, t.team.id)));
    expect(results.filter((r) => r.status === "CONFIRMED")).toHaveLength(3);
    expect(results.filter((r) => r.status === "WAITLISTED")).toHaveLength(4);
    const confirmedTeams = await getDb().registration.groupBy({ by: ["teamId"], where: { eventId: e.id, status: "CONFIRMED" } });
    expect(confirmedTeams).toHaveLength(3);
  });

  it("a member joining a registered team is registered with it; a member cannot leave if that drops below the minimum", async () => {
    const o = await organizer();
    const e = await teamEvent(o); // 2 to 3
    const h = makeHarness();
    const { leader, team, members } = await teamWith(e.id, 2, h);
    await registerTeam(leader.actor, team.id);
    await expect(leaveTeam(members[1].actor, team.id)).rejects.toMatchObject({ code: "team_too_small" });
    const newcomer = await participant();
    await inviteMember(leader.actor, team.id, newcomer.u.email, h.deps);
    await h.flush();
    await respondToInvitation(newcomer.actor, { token: tokenFrom(h.lastMailTo(newcomer.u.email)) }, true);
    expect((await getDb().registration.findUniqueOrThrow({ where: { eventId_userId: { eventId: e.id, userId: newcomer.u.id } } })).status).toBe("CONFIRMED");
    await leaveTeam(members[1].actor, team.id); // 3 -> 2 is fine
    const left = await getDb().registration.findUniqueOrThrow({ where: { eventId_userId: { eventId: e.id, userId: members[1].u.id } } });
    expect(left.status).toBe("CANCELLED");
    expect(left.cancelledAt).not.toBeNull();
  });

  it("team size limits cannot be changed once teams exist, and team events need both limits", async () => {
    const o = await organizer();
    const e = await teamEvent(o);
    await teamWith(e.id, 1);
    await expect(updateEvent(o.actor, e.id, { maxTeamSize: 5 })).rejects.toMatchObject({ status: 409 });
    await expect(updateEvent(o.actor, e.id, { registrationMode: "INDIVIDUAL" })).rejects.toMatchObject({ status: 409 });
  });

  it("only the team's own leader can disband or cancel; a disbanded team cannot register", async () => {
    const o = await organizer();
    const e = await teamEvent(o);
    const { leader, team, members } = await teamWith(e.id, 2);
    await expect(disbandTeam(members[1].actor, team.id)).rejects.toMatchObject({ status: 403 });
    await expect(cancelTeamRegistration((await participant()).actor, team.id)).rejects.toMatchObject({ status: 404 });
    await disbandTeam(leader.actor, team.id);
    await expect(registerTeam(leader.actor, team.id)).rejects.toMatchObject({ status: 404 });
  });
});
