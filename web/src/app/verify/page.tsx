import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Input } from "@/components/ui/field";

export const metadata: Metadata = { title: "Verify a certificate", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function VerifyPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Container className="max-w-xl py-14 sm:py-20">
      <h1 className="text-h1 font-semibold">Verify a certificate</h1>
      <p className="mt-3 text-fg-muted">Enter the code printed on the certificate (it looks like ST-ABCDE-FGHJK-LMNPQ).</p>
      <Suspense fallback={null}>
        <Redirect searchParams={searchParams} />
      </Suspense>
      <form method="get" action="/verify" className="mt-8 space-y-4" role="search" aria-label="Verify a certificate">
        <label htmlFor="code" className="text-sm font-medium">Certificate code</label>
        <Input id="code" name="code" required maxLength={30} autoComplete="off" autoCapitalize="characters" />
        <Button type="submit">Verify</Button>
      </form>
    </Container>
  );
}

async function Redirect({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).code;
  const code = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (code) redirect(`/verify/certificate/${encodeURIComponent(code.slice(0, 30))}`);
  return null;
}
