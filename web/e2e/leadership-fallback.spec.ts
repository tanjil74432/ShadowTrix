import { randomUUID } from "node:crypto";
import { db, expect, test } from "./helpers/fixtures";

/**
 * The homepage keeps its labelled placeholder profiles only while NO verified member is published. To prove that, this test hides every published
 * member for a moment, which would break unrelated tests running at the same time, so it runs alone in the `chromium-global-state` project
 * (after the rest of the suite) and puts every member back in all cases.
 */
test("with no eligible member the homepage keeps its placeholder profiles as a fallback", async ({ page }) => {
  test.setTimeout(90_000);
  const t = randomUUID().slice(0, 6);
  const live = await db().orgMember.findMany({ where: { visibility: "PUBLISHED", isPlaceholder: false }, select: { id: true } });
  const draft = await db().orgMember.create({ data: { slug: `e2e-fb-${t}`, fullName: `Only Draft ${t}`, visibility: "DRAFT", isPlaceholder: false } });
  try {
    await db().orgMember.updateMany({ where: { id: { in: live.map((x) => x.id) } }, data: { visibility: "DRAFT" } });
    await page.goto("/");
    await expect(page.getByText("Name to be announced").first()).toBeVisible();
    await expect(page.getByText(/placeholder profiles that show the card layout/)).toBeVisible();
    await expect(page.getByTestId("leadership-card")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Teams" }).getByRole("link", { name: "Leadership Board" })).toHaveAttribute("href", "/about/team#executive-board");
  } finally {
    await db().orgMember.updateMany({ where: { id: { in: live.map((x) => x.id) } }, data: { visibility: "PUBLISHED" } });
    await db().orgMember.deleteMany({ where: { id: draft.id } });
  }
});
