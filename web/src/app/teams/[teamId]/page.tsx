import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { ApiButton } from "@/components/common/api-button";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { EditTeamForm } from "@/components/team/edit-team-form";
import { InviteForm } from "@/components/team/invite-form";
import { formatDateTime } from "@/lib/format";
import { requireUser } from "@/server/modules/auth/dal";
import { getTeamForMember } from "@/server/modules/teams/teams.service";

export const metadata: Metadata = { title: "Your team", robots: { index: false, follow: false } };

type Params = Promise<{ teamId: string }>;

export default function TeamPage({ params }: { params: Params }) {
  return (
    <Container className="py-14 sm:py-20">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <TeamContent params={params} />
      </Suspense>
    </Container>
  );
}

async function TeamContent({ params }: { params: Params }) {
  const { teamId } = await params;
  const id = z.uuid().safeParse(teamId);
  if (!id.success) notFound();
  const user = await requireUser(`/teams/${id.data}`);
  await connection();
  let team;
  try {
    team = await getTeamForMember(user, id.data);
  } catch {
    notFound(); // non-members cannot tell whether a team exists
  }
  const e = team.event;
  const min = e.minTeamSize ?? 1;
  const max = e.maxTeamSize;
  const active = team.status === "ACTIVE";
  const now = new Date();
  const formationOpen = active && e.status === "PUBLISHED" && now < e.registrationClosesAt && now < e.endsAt;

  return (
    <>
      <p className="text-sm"><Link href="/dashboard" className="underline underline-offset-4 text-fg-muted">My dashboard</Link></p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-h1 font-semibold text-balance">{team.name}</h1>
        {team.isLeader && <Badge className="text-fg">You lead this team</Badge>}
        {!active && <Badge>Disbanded</Badge>}
      </div>
      <p className="mt-2 text-fg-muted">
        Team for <Link href={`/events/${e.slug}`} className="underline underline-offset-4">{e.title}</Link>. Teams of {min}{max ? ` to ${max}` : " or more"} members.
      </p>
      {team.description && <p className="mt-4 max-w-2xl text-fg-muted text-pretty">{team.description}</p>}

      <section aria-labelledby="members-heading" className="mt-10">
        <h2 id="members-heading" className="text-h3 font-semibold">Members ({team.members.length}{max ? ` of ${max}` : ""})</h2>
        <ul className="mt-4 space-y-2">
          {team.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-4 shadow-card">
              <span className="font-medium">{m.user.fullName} {m.role === "LEADER" && <Badge className="ml-2 text-fg">Leader</Badge>}</span>
              <span className="flex items-center gap-3 text-sm text-fg-muted">
                <time dateTime={m.joinedAt.toISOString()}>Joined {formatDateTime(m.joinedAt, "UTC")}</time>
                {team.isLeader && m.userId !== user.id && active && (
                  <ApiButton url={`/api/v1/teams/${team.id}/members/${m.userId}`} method="DELETE" variant="ghost" confirm={`Remove ${m.user.fullName} from the team?`}>
                    Remove
                  </ApiButton>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {active && (
        <section aria-labelledby="registration-heading" className="mt-10 max-w-2xl space-y-3">
          <h2 id="registration-heading" className="text-h3 font-semibold">Event registration</h2>
          {team.registration ? (
            <p role="status" className={`rounded-md border border-l-4 px-4 py-3 text-sm text-silver ${team.registration === "CONFIRMED" ? "border-success/40 border-l-success bg-[#0f2418]" : "border-warning/40 border-l-warning bg-[#2a2410]"}`}>
              {team.registration === "CONFIRMED" ? "Your team is registered and confirmed." : "Your team is on the waiting list. It is confirmed automatically if a place opens."}
            </p>
          ) : (
            <p className="text-fg-muted">Register the team when everyone has joined. The team needs {min}{max ? ` to ${max}` : " or more"} members.</p>
          )}
          {team.isLeader &&
            (team.registration ? (
              <ApiButton url={`/api/v1/teams/${team.id}/registration`} method="DELETE" confirm="Cancel the team's registration?">Cancel team registration</ApiButton>
            ) : (
              <ApiButton url={`/api/v1/teams/${team.id}/registration`} variant="primary" className="">Register this team</ApiButton>
            ))}
          {team.registration === "CONFIRMED" && (
            <p><Link href={`/events/${e.slug}/submission`} className="font-medium underline underline-offset-4">Go to your project submission</Link></p>
          )}
        </section>
      )}

      {team.isLeader && active && (
        <>
          <section aria-labelledby="invitations-heading" className="mt-10 max-w-2xl space-y-4">
            <h2 id="invitations-heading" className="text-h3 font-semibold">Invitations</h2>
            {team.invitations.length === 0 ? (
              <p className="text-fg-muted">No open invitations.</p>
            ) : (
              <ul className="space-y-2">
                {team.invitations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-4 shadow-card">
                    <span className="break-all">{i.inviteeEmail} <span className="text-sm text-fg-subtle">(expires <time dateTime={i.expiresAt.toISOString()}>{formatDateTime(i.expiresAt, "UTC")}</time>)</span></span>
                    <ApiButton url={`/api/v1/teams/${team.id}/invitations/${i.id}`} method="DELETE" variant="ghost">Revoke</ApiButton>
                  </li>
                ))}
              </ul>
            )}
            {formationOpen ? <InviteForm teamId={team.id} /> : <p className="text-fg-muted">Registration for this event has closed, so no new members can be invited.</p>}
          </section>
          <section aria-labelledby="edit-heading" className="mt-10 max-w-2xl">
            <h2 id="edit-heading" className="text-h3 font-semibold">Team details</h2>
            <div className="mt-4"><EditTeamForm teamId={team.id} name={team.name} description={team.description ?? ""} /></div>
          </section>
        </>
      )}

      {active && (
        <section aria-labelledby="leave-heading" className="mt-12 max-w-2xl space-y-3">
          <h2 id="leave-heading" className="text-h3 font-semibold">{team.isLeader ? "Disband" : "Leave"}</h2>
          {team.isLeader ? (
            <ApiButton url={`/api/v1/teams/${team.id}`} method="DELETE" confirm="Disband this team? Members are released and open invitations are revoked." doneHref="/dashboard">Disband team</ApiButton>
          ) : (
            <ApiButton url={`/api/v1/teams/${team.id}/leave`} confirm="Leave this team?" doneHref="/dashboard">Leave team</ApiButton>
          )}
        </section>
      )}
    </>
  );
}
