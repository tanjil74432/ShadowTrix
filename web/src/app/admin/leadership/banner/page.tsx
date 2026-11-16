import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { AdminShell } from "@/components/admin/admin-shell";
import { BannerCreator } from "@/components/banner/banner-creator";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/modules/auth/dal";
import { getBannerMember, listBannerMembers } from "@/server/modules/organization/banner.service";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export const metadata: Metadata = { title: "Member banner", robots: { index: false, follow: false } };

export default function AdminBannerPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<Container className="py-14"><Skeleton className="h-96 w-full" /></Container>}>
      <AdminShell section="banner" returnTo="/admin/leadership/banner"><Content searchParams={searchParams} /></AdminShell>
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireUser("/admin/leadership/banner");
  await connection();
  const sp = await searchParams;
  const id = z.uuid().safeParse(Array.isArray(sp.member) ? sp.member[0] : sp.member);
  const members = await listBannerMembers(actor);
  const subject = id.success ? await getBannerMember(actor, id.data).catch(() => null) : null;
  return (
    <>
      <h1 className="text-h1 font-semibold">Member banner</h1>
      <p className="mt-2 max-w-3xl text-fg-muted">
        Generate the official banner for a verified, active organization member. Designations come from the member&apos;s approved positions.{" "}
        <Link href="/admin/leadership" className="underline underline-offset-4">Back to leadership</Link>
      </p>
      {members.length === 0 ? (
        <EmptyState className="mt-8" title="No verified members yet" description="Verify a member profile first. Placeholders cannot have a banner." />
      ) : (
        <form method="get" action="/admin/leadership/banner" className="mt-6 flex max-w-xl items-end gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="bm" className="text-sm font-medium">Member</label>
            <Select id="bm" name="member" defaultValue={id.success ? id.data : ""}>
              <option value="">Choose a member</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}{m.memberships[0] ? `, ${m.memberships[0].designation.title}` : ""}</option>)}
            </Select>
          </div>
          <Button type="submit">Open</Button>
        </form>
      )}
      {subject && <div className="mt-8"><BannerCreator key={id.success ? id.data : "x"} subject={{ fullName: subject.fullName, designations: subject.designations }} /></div>}
    </>
  );
}
