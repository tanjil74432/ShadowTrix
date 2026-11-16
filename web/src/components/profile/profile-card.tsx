import Image from "next/image";
import Link from "next/link";
import { PlaceholderBadge } from "@/components/ui/badge";
import { UserIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

export interface ProfileSummary {
  slug: string;
  name: string;
  designation: string;
  /** e.g. "2026–27". Shown as the leadership term. */
  term?: string;
  photoUrl?: string | null;
  isPlaceholder?: boolean;
  /** Profile page link. Omitted until the profile page exists / is published. */
  href?: string;
}

interface ProfileCardProps {
  profile: ProfileSummary;
  headingLevel?: "h3" | "h4";
  className?: string;
}

/**
 * Leadership / team card: photo, name, designation, term. Fixed 4:5 portrait ratio so grids stay aligned.
 * Placeholder profiles show a visible badge and a neutral silhouette, never an invented face or name.
 */
export function ProfileCard({ profile, headingLevel: Heading = "h3", className }: ProfileCardProps) {
  const { name, designation, term, photoUrl, isPlaceholder, href } = profile;
  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-lg bg-surface shadow-card transition-[box-shadow,transform] duration-(--duration-base) ease-out-soft",
        href && "hover:-translate-y-1 hover:shadow-card-hover focus-within:shadow-card-hover motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      <div className="relative aspect-[4/5] bg-surface-raised">
        {photoUrl ? (
          <Image
            src={photoUrl}
            alt={`Portrait of ${name}`}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            className="object-cover"
          />
        ) : (
          <div aria-hidden className="relative grid h-full place-items-center overflow-hidden bg-[radial-gradient(ellipse_70%_60%_at_50%_35%,rgb(217_95_27/0.28),transparent_75%)] text-6xl text-accent/60">
            <div className="bg-grid absolute inset-0 opacity-70" />
            <UserIcon strokeWidth={1} className="relative size-1/3" />
          </div>
        )}
        {isPlaceholder && <PlaceholderBadge className="absolute top-3 left-3" />}
      </div>
      <div className="panel-orange space-y-1.5 rounded-none border-x-0 border-b-0 p-4">
        <Heading className="font-semibold text-balance text-fg">
          {href ? (
            <Link href={href} className="after:absolute after:inset-0 after:content-['']">
              {name}
            </Link>
          ) : (
            name
          )}
        </Heading>
        <span aria-hidden className="block h-0.5 w-8 rounded-full bg-gradient-to-r from-accent to-accent-soft" />
        <p className="text-sm font-semibold text-accent-soft">{designation}</p>
        {term && <p className="text-sm text-fg-muted">Term: {term}</p>}
      </div>
    </article>
  );
}
