import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Parses --color-* tokens straight from globals.css so tests cannot drift from the real values. */
const css = readFileSync(path.resolve(import.meta.dirname, "../src/app/globals.css"), "utf8");
const tokens = Object.fromEntries(
  [...css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]),
) as Record<string, string>;

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [l1, l2] = [luminance(tokens[a]), luminance(tokens[b])].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

describe("design tokens", () => {
  it("defines the required color tokens", () => {
    for (const t of ["bg", "surface", "surface-raised", "border", "fg", "fg-muted", "fg-subtle", "silver", "accent", "accent-deep", "accent-soft", "on-accent", "accent-wash", "success", "warning", "danger"]) {
      expect(tokens[t], t).toBeDefined();
    }
  });

  it("keeps the brand base near-black", () => {
    expect(tokens.bg.toLowerCase()).toBe("#090909");
  });

  // WCAG 2.2 AA: 4.5:1 for body text.
  const textPairs: [string, string][] = [
    ["fg", "bg"],
    ["fg", "surface"],
    ["fg", "surface-raised"],
    ["fg-muted", "bg"],
    ["fg-muted", "surface"],
    ["fg-muted", "surface-raised"],
    ["fg-subtle", "bg"],
    ["fg-subtle", "surface"],
    ["fg-subtle", "surface-raised"],
    ["silver", "bg"],
    ["danger", "bg"],
    ["danger", "surface-raised"],
    ["accent", "bg"], // orange text and focus ring on the page
    ["accent", "surface"],
    ["accent-soft", "bg"],
    ["accent-soft", "surface-raised"],
    ["accent-soft", "accent-wash"], // orange text on tinted badges
    ["fg", "accent-wash"],
    ["success", "surface"],
    ["warning", "surface"],
    ["success", "bg"],
    ["on-accent", "accent"], // dark text on orange buttons
    ["on-accent", "accent-soft"], // hover
    ["on-accent", "accent-deep"], // pressed
  ];
  it.each(textPairs)("text %s on %s has at least 4.5:1 contrast", (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  // WCAG 1.4.11: 3:1 for the boundary of form controls.
  it("form-control borders have at least 3:1 contrast against the page", () => {
    expect(contrast("field-border", "bg")).toBeGreaterThanOrEqual(3);
    expect(contrast("field-border", "surface-raised")).toBeGreaterThanOrEqual(3);
  });
});
