import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Previous / next links that keep the rest of the query string. */
export function Pager({ page, total, pageSize, hrefFor }: { page: number; total: number; pageSize: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-6 flex items-center justify-between gap-4">
      {page > 1 ? <Button asChild variant="secondary"><Link href={hrefFor(page - 1)} rel="prev">Previous</Link></Button> : <span />}
      <span className="text-sm text-fg-muted">Page {page} of {pages}</span>
      {page < pages ? <Button asChild variant="secondary"><Link href={hrefFor(page + 1)} rel="next">Next</Link></Button> : <span />}
    </nav>
  );
}
