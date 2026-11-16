import { cacheLife } from "next/cache";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { nav, site } from "@/lib/site";
import { BrandLogo } from "./brand-logo";

const columns = [
  { title: "Platform", links: [nav.primary[0], nav.primary[1]] },
  { title: "About", links: [...nav.about.items, nav.primary[2]] },
  { title: "Account", links: [nav.account.login, nav.account.register] },
] as const;

/** Current year, cached (Cache Components forbids reading the clock during prerender). Refreshes daily. */
async function CurrentYear() {
  "use cache";
  cacheLife("days");
  return new Date().getFullYear();
}

export function Footer() {
  return (
    <footer className="ambient-bottom border-t border-accent/25 bg-surface">
      <Container className="py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="max-w-xs">
            <BrandLogo />
            <p className="mt-4 text-sm text-fg-muted text-pretty">
              Competitions, events and a community for people who build technology.
            </p>
          </div>
          {columns.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h2 className="text-sm font-semibold">{col.title}</h2>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-sm text-fg-muted transition-colors hover:text-fg">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t border-border pt-6 text-sm text-fg-subtle sm:flex-row sm:justify-between">
          <p>
            © <CurrentYear /> {site.name}
          </p>
          <p>Operated by {site.operator}</p>
        </div>
      </Container>
    </footer>
  );
}
