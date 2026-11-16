import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { site } from "@/lib/site";

/** Official logo mark (unmodified artwork, transparent derivative) plus the ShadowTrix wordmark in plain white bold text (no gradient or glow). */
export function BrandLogo({ className, size = 36 }: { className?: string; size?: number }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight", className)}>
      <Image src={site.logo.src} alt="" width={size} height={size} className="brand-logo shrink-0" />
      <span className="text-[17px] leading-none font-bold tracking-tight text-white min-[360px]:text-xl">{site.name}</span>
      <span className="sr-only"> home</span>
    </Link>
  );
}
