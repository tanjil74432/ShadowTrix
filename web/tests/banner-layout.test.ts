import { describe, expect, it } from "vitest";
import { BANNER_H, BANNER_W, BG_TEXT_MAX, BG_ZONE, DEFAULT_BACKGROUND, FRAME, PANEL, TEXT_X, planBackgroundText, planPanel, type BackgroundText } from "@/lib/banner/render";

/** A measuring context that behaves like a proportional font: width grows with text length and font size. */
function fakeContext() {
  const ctx = {
    font: "",
    measureText(text: string) {
      const px = Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 16);
      return { width: text.length * px * 0.58 };
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}
const measure = (font: string, text: string) => {
  const g = fakeContext();
  g.font = font;
  return g.measureText(text).width;
};
const EPS = 0.51;

describe("one universal layout", () => {
  it("the artwork is 1080 x 1350 and the portrait and panel tile it without overlapping", () => {
    expect([BANNER_W, BANNER_H]).toEqual([1080, 1350]);
    expect(FRAME.y + FRAME.h).toBeLessThanOrEqual(PANEL.y);
    expect(FRAME.x).toBe(PANEL.x);
    expect(FRAME.w).toBe(PANEL.w);
    expect(PANEL.y + PANEL.h).toBeLessThanOrEqual(BANNER_H);
    expect(PANEL.x + PANEL.w).toBeLessThanOrEqual(BANNER_W);
    expect(BG_ZONE.x).toBeGreaterThanOrEqual(0);
    expect(BG_ZONE.x + BG_ZONE.w).toBeLessThanOrEqual(BANNER_W);
    expect(BG_ZONE.y + BG_ZONE.h).toBeLessThanOrEqual(FRAME.y + 220); // the text sits above and just behind the top of the photo
  });
});

describe("background text", () => {
  const base: BackgroundText = { ...DEFAULT_BACKGROUND };

  it("an empty text draws nothing; the text is upper-cased, trimmed and limited", () => {
    expect(planBackgroundText(fakeContext(), { ...base, text: "   " }, "sans-serif")).toBeNull();
    expect(planBackgroundText(fakeContext(), { ...base, text: "  co-founder " }, "sans-serif")?.text).toBe("CO-FOUNDER");
    expect(planBackgroundText(fakeContext(), { ...base, text: "x".repeat(100) }, "sans-serif")?.text).toHaveLength(BG_TEXT_MAX);
    expect(planBackgroundText(fakeContext(), { ...base, text: "a   b\n c" }, "sans-serif")?.text).toBe("A B C");
  });

  it("whatever size, position, rotation and text length is chosen, the box stays inside the banner zone (no clipping)", () => {
    const texts = ["JUDGE", "TEAM MEMBER", "ORGANIZER", "W".repeat(BG_TEXT_MAX), "I"];
    for (const text of texts) for (const size of [-50, 60, 200, 320, 9999]) for (const rotation of [-90, -30, 0, 17, 30, 90]) for (const x of [-5, -1, 0, 0.4, 1, 5]) for (const y of [-5, -1, 0, 1, 5]) {
      const p = planBackgroundText(fakeContext(), { text, size, rotation, x, y, opacity: 0.2 }, "sans-serif")!;
      expect(p).not.toBeNull();
      expect(p.box.x).toBeGreaterThanOrEqual(BG_ZONE.x - EPS);
      expect(p.box.y).toBeGreaterThanOrEqual(BG_ZONE.y - EPS);
      expect(p.box.x + p.box.w).toBeLessThanOrEqual(BG_ZONE.x + BG_ZONE.w + EPS);
      expect(p.box.y + p.box.h).toBeLessThanOrEqual(BG_ZONE.y + BG_ZONE.h + EPS);
      expect(p.size).toBeLessThanOrEqual(320);
      expect(p.rotation).toBeGreaterThanOrEqual(-30);
      expect(p.rotation).toBeLessThanOrEqual(30);
    }
  });

  it("size grows the text until the zone is reached, and the sliders move it", () => {
    const small = planBackgroundText(fakeContext(), { ...base, text: "JUDGE", size: 80 }, "sans-serif")!;
    const large = planBackgroundText(fakeContext(), { ...base, text: "JUDGE", size: 240 }, "sans-serif")!;
    expect(large.size).toBeGreaterThan(small.size);
    expect(small.size).toBe(80);
    const left = planBackgroundText(fakeContext(), { ...base, text: "JUDGE", size: 100, x: -1 }, "sans-serif")!;
    const right = planBackgroundText(fakeContext(), { ...base, text: "JUDGE", size: 100, x: 1 }, "sans-serif")!;
    expect(right.cx).toBeGreaterThan(left.cx);
    const up = planBackgroundText(fakeContext(), { ...base, text: "JUDGE", size: 100, y: -1 }, "sans-serif")!;
    const down = planBackgroundText(fakeContext(), { ...base, text: "JUDGE", size: 100, y: 1 }, "sans-serif")!;
    expect(down.cy).toBeGreaterThan(up.cy);
  });

  it("opacity is limited to a partly transparent range, and non-numbers fall back to defaults", () => {
    expect(planBackgroundText(fakeContext(), { ...base, opacity: 5 }, "sans-serif")!.opacity).toBe(0.6);
    expect(planBackgroundText(fakeContext(), { ...base, opacity: 0 }, "sans-serif")!.opacity).toBe(0.05);
    const bad = planBackgroundText(fakeContext(), { text: "OK", size: NaN, x: NaN, y: NaN, opacity: NaN, rotation: NaN }, "sans-serif")!;
    expect(bad.opacity).toBe(DEFAULT_BACKGROUND.opacity);
    expect(bad.rotation).toBe(0);
    expect(Number.isFinite(bad.cx) && Number.isFinite(bad.cy) && Number.isFinite(bad.size)).toBe(true);
  });

  it("the default is decoration, not a role", () => {
    expect(DEFAULT_BACKGROUND.text).toBe("SHADOW");
    expect(DEFAULT_BACKGROUND.opacity).toBeLessThan(0.5);
  });
});

describe("information panel: nothing overlaps or leaves the panel, whatever is shown", () => {
  const long = "Priyanka Wickramasinghe-Balasubramaniam Longname Of The Extremely Long Variety";
  const full = {
    name: long,
    designation: "President of the Executive Committee and Head of Everything",
    university: "The Bangladesh University of Engineering and Technology Extended Campus",
    department: "Department of Computer Science and Engineering Graduate Program",
    event: "ShadowTrix International Spring Hackathon and Datathon 2026 Grand Finals",
    team: "Team Matrix Innovators of the Eastern Region",
    tagline: "Building things that matter, one commit at a time, together with the whole ShadowTrix community.",
  };
  const cases: [string, Parameters<typeof planPanel>[1]][] = [
    ["name only", { name: "Ada" }],
    ["everything, very long", full],
    ["every field at its maximum length", { name: "W".repeat(60), designation: "D".repeat(80), university: "U".repeat(80), department: "P".repeat(80), event: "E".repeat(80), team: "T".repeat(60), tagline: "G".repeat(90) }],
    ["single words that cannot wrap", { name: "Wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww", university: "Universitätsverwaltungsangestelltenvereinigungsvorsitzender", tagline: "Hi" }],
    ["some rows hidden", { name: "Short Name", university: "MIT", tagline: "Hello" }],
    ["only the event", { name: "Short Name", event: "Hack" }],
  ];

  for (const [label, input] of cases) {
    it(`${label}: every row fits its width, rows are in order and the last one ends inside the panel`, () => {
      const plan = planPanel(fakeContext(), input, "sans-serif");
      expect(plan.name.lines.length).toBeLessThanOrEqual(2);
      for (const line of plan.name.lines) expect(measure(plan.name.font, line)).toBeLessThanOrEqual(plan.name.maxW + EPS);
      let prevEnd = plan.bar + 5;
      for (const row of plan.rows) {
        expect(row.lines.length).toBeGreaterThan(0);
        expect(row.lines.length).toBeLessThanOrEqual(["designation", "department", "team"].includes(row.key) ? 1 : 2);
        for (const line of row.lines) expect(measure(row.font, line)).toBeLessThanOrEqual(row.maxW + EPS);
        expect(row.baseline - row.px).toBeGreaterThanOrEqual(prevEnd - 1); // starts below the previous row
        prevEnd = row.baseline + (row.lines.length - 1) * row.px * 1.2;
      }
      // no line touches the logo or the brand caption in the top-right corner
      const lines = [
        ...plan.name.lines.map((text, i) => ({ text, font: plan.name.font, y: plan.name.baseline + i * plan.name.px * 1.05, px: plan.name.px })),
        ...plan.rows.flatMap((r) => r.lines.map((text, i) => ({ text, font: r.font, y: r.baseline + i * r.px * 1.2, px: r.px }))),
      ];
      for (const l of lines) {
        const box = { x: TEXT_X, y: l.y - l.px * 0.85, w: measure(l.font, l.text), h: l.px * 1.1 };
        for (const zone of [plan.brand.logo, plan.brand.caption]) {
          const overlaps = box.x < zone.x + zone.w + 8 && box.x + box.w > zone.x - 8 && box.y < zone.y + zone.h + 4 && box.y + box.h > zone.y - 4;
          expect(overlaps, `"${l.text}" must not touch the logo or the caption`).toBe(false);
        }
        expect(box.x + box.w).toBeLessThanOrEqual(PANEL.x + PANEL.w - 40 + EPS); // and stays inside the panel's right padding
      }
      expect(plan.bottom).toBeLessThanOrEqual(PANEL.y + PANEL.h - 20);
      expect(prevEnd).toBeLessThanOrEqual(PANEL.y + PANEL.h - 20);
      expect(plan.name.baseline).toBeGreaterThan(PANEL.y);
    });
  }

  it("only the information that is provided produces rows, so hiding a field removes its line", () => {
    const all = planPanel(fakeContext(), full, "sans-serif").rows.map((r) => r.key);
    expect(all).toEqual(["designation", "university", "department", "event", "team", "tagline"]);
    expect(planPanel(fakeContext(), { ...full, designation: undefined }, "sans-serif").rows.map((r) => r.key)).toEqual(["university", "department", "event", "team", "tagline"]);
    expect(planPanel(fakeContext(), { ...full, department: undefined, team: undefined }, "sans-serif").rows.map((r) => r.key)).toEqual(["designation", "university", "event", "tagline"]);
    expect(planPanel(fakeContext(), { name: "A", university: "U", department: "D" }, "sans-serif").rows.map((r) => r.key)).toEqual(["university", "department"]);
    expect(planPanel(fakeContext(), { name: "A", event: "E", team: "T" }, "sans-serif").rows.map((r) => r.lines.join(" "))).toEqual(["E", "T"]);
    expect(planPanel(fakeContext(), { name: "A" }, "sans-serif").rows).toEqual([]);
    expect(planPanel(fakeContext(), { name: "A", university: "   ", tagline: "" }, "sans-serif").rows).toEqual([]);
  });
});
