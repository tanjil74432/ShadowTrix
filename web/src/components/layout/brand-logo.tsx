import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { site } from "@/lib/site";

/** Official logo mark (unmodified artwork, transparent derivative) plus the ShadowTrix wordmark in text. */
export function BrandLogo({ className, size = 36 }: { className?: string; size?: number }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight", className)}>
      <Image src={site.logo.src} alt="" width={size} height={size} className="shrink-0" />
      <span className="text-lg">{site.name}</span>
      <span className="sr-only"> home</span>
    </Link>
  );
}
