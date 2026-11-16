import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Container } from "@/components/ui/container";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { verifyCertificate } from "@/server/modules/certificates/certificates.service";

export const metadata: Metadata = { title: "Certificate verification", robots: { index: false, follow: false } };

type Params = Promise<{ code: string }>;

export default function VerifyCertificatePage({ params }: { params: Params }) {
  return (
    <Container className="max-w-2xl py-14 sm:py-20">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Verification params={params} />
      </Suspense>
    </Container>
  );
}

const TYPE: Record<string, string> = { PARTICIPATION: "Participation", FINALIST: "Distinction (finalist)", WINNER: "Achievement (winner)" };

async function Verification({ params }: { params: Params }) {
  await connection();
  const { code } = await params;
  const r = await verifyCertificate(decodeURIComponent(code).slice(0, 40));
  return (
    <>
      <h1 className="text-h1 font-semibold">Certificate verification</h1>
      {r.status === "NOT_FOUND" ? (
        <div role="status" className="mt-6 space-y-3">
          <p className="text-h3 font-semibold">No certificate found</p>
          <p className="text-fg-muted">There is no certificate with this code. Check the code for typing mistakes.</p>
        </div>
      ) : (
        <div role="status" className="mt-6 space-y-4">
          <p className="text-h3 font-semibold">{r.status === "VALID" ? "This certificate is genuine" : "This certificate was revoked"}</p>
          {r.status === "REVOKED" && <p className="text-fg-muted">It is no longer valid{r.revokedAt ? ` (revoked ${formatDate(r.revokedAt, "UTC")})` : ""}.</p>}
          <dl className="space-y-3 rounded-lg bg-surface p-6 shadow-card">
            <div><dt className="text-sm text-fg-subtle">Issued to</dt><dd className="font-medium">{r.recipientName}</dd></div>
            <div><dt className="text-sm text-fg-subtle">Event</dt><dd className="font-medium">{r.eventTitle}</dd></div>
            <div><dt className="text-sm text-fg-subtle">Type</dt><dd className="font-medium">{TYPE[r.type] ?? r.type}</dd></div>
            <div><dt className="text-sm text-fg-subtle">Issued</dt><dd className="font-medium"><time dateTime={r.issuedAt.toISOString()}>{formatDate(r.issuedAt, "UTC")}</time></dd></div>
          </dl>
        </div>
      )}
      <p className="mt-8 text-sm"><Link href="/verify" className="underline underline-offset-4">Verify another certificate</Link></p>
    </>
  );
}
