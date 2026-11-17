import { describe, expect, it } from "vitest";
import { BANNER_H, BANNER_W, BG_TEXT_MAX, BG_ZONE, COLUMN, DEFAULT_BACKGROUND, FRAME, HEADING_GAP, OPACITY_RANGE, PANEL, ROTATION_RANGE, SIZE_RANGE, TEXT_X, planBackgroundText, planPanel, type BackgroundText } from "@/lib/banner/render";

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
    // Option A: the identity text is a heading ABOVE the photo, lined up with it, with a clear gap, never reaching into the frame
    expect(BG_ZONE.y).toBeGreaterThanOrEqual(0);
    expect(BG_ZONE.y + BG_ZONE.h).toBeLessThan(FRAME.y);
    expect(HEADING_GAP).toBeGreaterThanOrEqual(20);
    expect(BG_ZONE.x).toBe(FRAME.x);
    expect(BG_ZONE.w).toBe(FRAME.w);
  });
});

describe("the portrait frame is slightly narrower and centred", () => {
  it("is modestly narrower than the previous 810 px, keeps its height, and has equal margins either side", () => {
    expect(FRAME.w).toBeLessThan(810);
    expect(FRAME.w).toBeGreaterThanOrEqual(700); // modest: not a dramatic change
    expect(FRAME.h).toBe(645); // height preserved
    // centred between the vertical rule (x = 170) and the right edge of the banner
    const leftMargin = FRAME.x - 170, rightMargin = BANNER_W - (FRAME.x + FRAME.w);
    expect(leftMargin).toBe(rightMargin);
    expect(leftMargin).toBeGreaterThanOrEqual(60);
    // the heading band, the frame and the information panel share one column
    for (const box of [BG_ZONE, FRAME, PANEL]) { expect(box.x).toBe(COLUMN.x); expect(box.w).toBe(COLUMN.w); }
  });
});

describe("identity text (the heading above the photo)", () => {
  const base: BackgroundText = { ...DEFAULT_BACKGROUND };

  it("an empty text draws nothing; the text is upper-cased, trimmed and limited", () => {
    expect(planBackgroundText(fakeContext(), { ...base, text: "   " }, "sans-serif")).toBeNull();
    expect(planBackgroundText(fakeContext(), { ...base, text: "  co-founder " }, "sans-serif")?.text).toBe("CO-FOUNDER");
    expect(planBackgroundText(fakeContext(), { ...base, text: "x".repeat(100) }, "sans-serif")?.text).toHaveLength(BG_TEXT_MAX);
    expect(planBackgroundText(fakeContext(), { ...base, text: "a   b\n c" }, "sans-serif")?.text).toBe("A B C");
  });

  it("whatever size, position, rotation and text length is chosen, the box stays inside the heading band: no clipping and never over the photo", () => {
    const texts = ["JUDGE", "TEAM MEMBER", "ORGANIZER", "CO-FOUNDER", "SHADOWTRIX", "W".repeat(BG_TEXT_MAX), "I", "A B"];
    for (const text of texts) for (const size of [-50, 60, 190, 200, 320, 9999]) for (const rotation of [-90, -12, 0, 7, 12, 90]) for (const x of [-5, -1, 0, 0.4, 1, 5]) for (const y of [-5, -1, 0, 1, 5]) {
      const p = planBackgroundText(fakeContext(), { text, size, rotation, x, y, opacity: 0.2 }, "sans-serif")!;
      expect(p).not.toBeNull();
      expect(p.box.x).toBeGreaterThanOrEqual(BG_ZONE.x - EPS);
      expect(p.box.y).toBeGreaterThanOrEqual(BG_ZONE.y - EPS);
      expect(p.box.x + p.box.w).toBeLessThanOrEqual(BG_ZONE.x + BG_ZONE.w + EPS);
      expect(p.box.y + p.box.h).toBeLessThanOrEqual(BG_ZONE.y + BG_ZONE.h + EPS);
      expect(p.box.y + p.box.h).toBeLessThanOrEqual(FRAME.y - HEADING_GAP + EPS); // a clear gap above the photo frame
      expect(p.size).toBeLessThanOrEqual(SIZE_RANGE.max);
      expect(p.rotation).toBeGreaterThanOrEqual(ROTATION_RANGE.min);
      expect(p.rotation).toBeLessThanOrEqual(ROTATION_RANGE.max);
    }
  });

  it("short text keeps the size asked for; long text shrinks to fit the band instead of being cut", () => {
    const short = planBackgroundText(fakeContext(), { ...base, text: "JUDGE", size: 150 }, "sans-serif")!;
    expect(short.size).toBe(150);
    const long = planBackgroundText(fakeContext(), { ...base, text: "W".repeat(BG_TEXT_MAX), size: 190 }, "sans-serif")!;
    expect(long.size).toBeLessThan(190);
    expect(long.box.w).toBeLessThanOrEqual(BG_ZONE.w + EPS);
    expect(long.text).toHaveLength(BG_TEXT_MAX);
  });

  it("size grows the text until the band is reached, and the sliders move it", () => {
    const small = planBackgroundText(fakeContext(), { ...base, text: "JUDGE", size: 80 }, "sans-serif")!;
    const large = planBackgroundText(fakeContext(), { ...base, text: "JUDGE", size: 160 }, "sans-serif")!;
    expect(large.size).toBeGreaterThan(small.size);
    expect(small.size).toBe(80);
    const left = planBackgroundText(fakeContext(), { ...base, text: "JUDGE", size: 100, x: -1 }, "sans-serif")!;
    const right = planBackgroundText(fakeContext(), { ...base, text: "JUDGE", size: 100, x: 1 }, "sans-serif")!;
    expect(right.cx).toBeGreaterThan(left.cx);
    const up = planBackgroundText(fakeContext(), { ...base, text: "JUDGE", size: 100, y: -1 }, "sans-serif")!;
    const down = planBackgroundText(fakeContext(), { ...base, text: "JUDGE", size: 100, y: 1 }, "sans-serif")!;
    expect(down.cy).toBeGreaterThan(up.cy);
  });

  it("opacity stays within its range, and non-numbers fall back to defaults", () => {
    expect(planBackgroundText(fakeContext(), { ...base, opacity: 5 }, "sans-serif")!.opacity).toBe(OPACITY_RANGE.max);
    expect(planBackgroundText(fakeContext(), { ...base, opacity: 0 }, "sans-serif")!.opacity).toBe(OPACITY_RANGE.min);
    const bad = planBackgroundText(fakeContext(), { text: "OK", size: NaN, x: NaN, y: NaN, opacity: NaN, rotation: NaN }, "sans-serif")!;
    expect(bad.opacity).toBe(DEFAULT_BACKGROUND.opacity);
    expect(bad.rotation).toBe(0);
    expect(Number.isFinite(bad.cx) && Number.isFinite(bad.cy) && Number.isFinite(bad.size)).toBe(true);
  });

  it("the default is decoration, not a role, and is large and clearly readable", () => {
    expect(DEFAULT_BACKGROUND.text).toBe("SHADOW");
    expect(DEFAULT_BACKGROUND.opacity).toBeGreaterThanOrEqual(0.8);
    expect(DEFAULT_BACKGROUND.size).toBeGreaterThanOrEqual(150);
    expect(DEFAULT_BACKGROUND.rotation).toBe(0);
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
      expect(plan.name.lines.length).toBeLessThanOrEqual(plan.rows.length === 0 && plan.scale >= 1.3 ? 3 : 2);
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

describe("the information panel adapts to what is shown", () => {
  const name = "Amina Rahman Chowdhury";
  const uni = "Bangladesh University of Engineering and Technology";
  const dept = "Computer Science and Engineering";
  const all = { name, designation: "Verified designation", university: uni, department: dept, event: "ShadowTrix Spring Hackathon 2026", team: "Team Matrix", tagline: "Enter the Matrix of Innovation." };
  const plan = (input: Parameters<typeof planPanel>[1]) => planPanel(fakeContext(), input, "sans-serif");

  it("the fewer the fields, the larger the type: name only > name + university > name + university + department > everything", () => {
    const a = plan({ name }), b = plan({ name, university: uni }), c = plan({ name, university: uni, department: dept }), d = plan(all);
    expect(a.name.px).toBeGreaterThan(b.name.px - 1);
    expect(b.name.px).toBeGreaterThanOrEqual(c.name.px);
    expect(c.name.px).toBeGreaterThanOrEqual(d.name.px);
    expect(a.scale).toBeGreaterThanOrEqual(b.scale);
    expect(b.scale).toBeGreaterThanOrEqual(c.scale);
    expect(c.scale).toBeGreaterThanOrEqual(d.scale);
    expect(a.name.px).toBeGreaterThanOrEqual(70); // a sparse banner gets a large, prominent name
    expect(plan({ name, university: uni }).rows[0].px).toBeGreaterThan(plan(all).rows.find((r) => r.key === "university")!.px - 1); // and larger details
    expect(plan({ name, university: uni, department: dept }).rows[0].px).toBeGreaterThanOrEqual(30);
  });

  it("a full panel stays compact but readable", () => {
    const d = plan(all);
    expect(d.scale).toBeLessThanOrEqual(1.1);
    for (const r of d.rows) expect(r.px).toBeGreaterThanOrEqual(16);
    expect(d.name.px).toBeGreaterThanOrEqual(34);
  });

  it("the content is centred in the panel, so a sparse panel is not top-heavy and does not leave an empty bottom", () => {
    for (const input of [{ name }, { name, university: uni }, { name, university: uni, department: dept }]) {
      const p = plan(input);
      const top = p.name.baseline - p.name.px * 0.85 - PANEL.y; // space above the block, from the panel's top edge
      const bottomGap = PANEL.y + PANEL.h - p.bottom; // space below it
      expect(Math.abs(top - bottomGap), JSON.stringify(input)).toBeLessThanOrEqual(60 + 24); // roughly balanced (the block sits beside the logo)
      expect(bottomGap).toBeLessThanOrEqual(130); // never a large empty area under the text
    }
  });

  it("hidden or empty optional fields leave no row and no gap", () => {
    const rows = (input: Parameters<typeof planPanel>[1]) => plan(input).rows.map((r) => r.key);
    expect(rows({ name })).toEqual([]);
    expect(rows({ name, university: "   ", department: "", event: undefined })).toEqual([]);
    expect(rows({ name, department: dept })).toEqual(["department"]);
    expect(rows(all)).toEqual(["designation", "university", "department", "event", "team", "tagline"]);
    // nothing is reserved for a hidden field: consecutive rows are exactly one normal line-gap apart, and the rest grow into the freed space
    for (const input of [all, { ...all, department: undefined }, { ...all, designation: undefined, event: undefined, tagline: undefined }]) {
      const p = plan(input);
      const air = Math.max(p.scale, 0.8);
      for (let i = 1; i < p.rows.length; i++) {
        const prev = p.rows[i - 1], next = p.rows[i];
        const expected = (prev.lines.length - 1) * prev.px * 1.2 + prev.px * 0.3 + 10 * air + next.px * 0.85;
        expect(next.baseline - prev.baseline, `${prev.key} -> ${next.key}`).toBeCloseTo(expected, 3);
      }
    }
    expect(plan({ ...all, department: undefined }).rows).toHaveLength(plan(all).rows.length - 1);
    expect(plan({ ...all, department: undefined }).scale).toBeGreaterThanOrEqual(plan(all).scale);
  });

  it("long names, long university names and long taglines never overlap, leave the panel or touch the logo", () => {
    const long = {
      name: "Dr. Mohammad Abdul Karim Chowdhury Bhuiyan",
      university: "The Bangladesh University of Engineering and Technology Extended Campus",
      tagline: "Building things that matter, one commit at a time, together with the whole ShadowTrix community.",
    };
    for (const input of [long, { name: long.name }, { name: "Amina", tagline: long.tagline }, { ...long, department: "Department of Computer Science and Engineering Graduate Program", event: "ShadowTrix International Spring Hackathon and Datathon 2026 Grand Finals", team: "Team Matrix Innovators of the Eastern Region" }]) {
      const p = plan(input);
      expect(p.bottom).toBeLessThanOrEqual(PANEL.y + PANEL.h - 20);
      let prevEnd = -Infinity;
      for (const l of [{ y: p.name.baseline, px: p.name.px, n: p.name.lines.length, lead: 1.05 }, ...p.rows.map((r) => ({ y: r.baseline, px: r.px, n: r.lines.length, lead: 1.2 }))]) {
        expect(l.y - l.px).toBeGreaterThanOrEqual(prevEnd - 1);
        prevEnd = l.y + (l.n - 1) * l.px * l.lead;
      }
    }
  });
});

describe("a slightly longer name stays on one line: the logo group moves down instead", () => {
  const ORIGINAL_LOGO_TOP = PANEL.y + 36;
  const inputs = (name: string) => [
    { name }, // sparse
    { name, university: "Bangladesh University of Engineering and Technology" },
    { name, designation: "Organizer", university: "BUET", department: "CSE", event: "Spring Hackathon 2026", team: "Team Matrix", tagline: "Enter the Matrix." },
  ];
  const sizes = Array.from({ length: 8 }, (_, i) => Array.from({ length: i + 1 }, () => "Abdul").join(" "));

  it("three outcomes, depending only on the name: it fits beside the logo (nothing moves), it fits the full width (one line, logo moves down), or it wraps as before", () => {
    const seen = { fits: false, widened: false, wraps: false };
    for (const name of sizes) for (const input of inputs(name)) {
      const p = planPanel(fakeContext(), input, "sans-serif");
      const nameBottom = p.name.baseline + p.name.px * 0.25;
      if (p.name.maxW === PANEL.w - 80) {
        seen.widened = true;
        expect(p.name.lines, name).toHaveLength(1); // stays on one line
        expect(p.brand.logo.y, name).toBeGreaterThan(ORIGINAL_LOGO_TOP); // the group moved down...
        expect(p.brand.logo.y, name).toBeGreaterThanOrEqual(nameBottom + 8); // ...just clear of the name line
        expect(p.brand.caption.y + p.brand.caption.h, name).toBeLessThanOrEqual(PANEL.y + PANEL.h - 12); // and stays inside the panel
      } else if (p.name.lines.length === 1) {
        seen.fits = true;
        expect(p.brand.logo.y, name).toBe(ORIGINAL_LOGO_TOP); // a name that already fitted changes nothing
      } else {
        seen.wraps = true;
        expect(p.brand.logo.y, name).toBe(ORIGINAL_LOGO_TOP); // a name that is too long for the full width wraps exactly as before
      }
    }
    expect(seen, "the sample covers every outcome").toEqual({ fits: true, widened: true, wraps: true });
  });

  it("the name is never shrunk to fit: its size is exactly what the panel's own scale gives it", () => {
    const scaleSize = (scale: number) => Math.round(Math.min(92, Math.max(34, 64 * scale)) / 2) * 2;
    let checked = 0;
    for (const name of sizes) for (const input of inputs(name)) {
      const p = planPanel(fakeContext(), input, "sans-serif");
      if (p.name.maxW === PANEL.w - 80) { expect(p.name.px, name).toBe(scaleSize(p.scale)); checked++; }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("any name that fits the full width at the base size (64 px) stays on one line, at no less than the base size", () => {
    const innerW = PANEL.w - 80;
    let checked = 0;
    for (const name of sizes) for (const input of inputs(name)) {
      if (name.length * 64 * 0.58 > innerW) continue; // too long even at the base size: it wraps, as before
      const p = planPanel(fakeContext(), input, "sans-serif");
      expect(p.name.lines, `${name} / ${Object.keys(input).length} fields`).toHaveLength(1);
      expect(p.name.px, name).toBeGreaterThanOrEqual(64);
      checked++;
    }
    expect(checked).toBeGreaterThan(6);
  });

  it("the logo and its caption stay visible, inside the panel, aligned to the same right edge, and never touch any text line", () => {
    for (const name of sizes) for (const input of inputs(name)) {
      const p = planPanel(fakeContext(), input, "sans-serif");
      const right = PANEL.x + PANEL.w - 40;
      expect(p.brand.logo.x + p.brand.logo.w).toBe(right);
      expect(p.brand.caption.x + p.brand.caption.w).toBeCloseTo(right, 5);
      expect(p.brand.logo.y).toBeGreaterThanOrEqual(PANEL.y + 36);
      expect(p.brand.caption.y + p.brand.caption.h).toBeLessThanOrEqual(PANEL.y + PANEL.h);
      const lines = [{ text: p.name.lines[0], font: p.name.font, y: p.name.baseline, px: p.name.px }, ...p.rows.flatMap((r) => r.lines.map((text, i) => ({ text, font: r.font, y: r.baseline + i * r.px * 1.2, px: r.px })))];
      for (const l of lines) for (const zone of [p.brand.logo, p.brand.caption]) {
        const box = { x: TEXT_X, y: l.y - l.px * 0.85, w: measure(l.font, l.text), h: l.px * 1.1 };
        const overlaps = box.x < zone.x + zone.w + 8 && box.x + box.w > zone.x - 8 && box.y < zone.y + zone.h + 4 && box.y + box.h > zone.y - 4;
        expect(overlaps, `"${l.text}" vs the logo group (${name})`).toBe(false);
      }
    }
  });
});
