import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { TEMPLATE_IDS, TEMPLATE_INFO, isTemplateId } from "@/lib/banner/template-registry";
import type { MatrixContext, MatrixRenderer } from "@/lib/banner/render";
import { DEFAULT_BACKGROUND, FRAME, PANEL } from "@/lib/banner/render";
import type { Actor } from "@/server/modules/authz/permissions";
import { assertTemplateAllowed, availableTemplates, canUseMatrix } from "@/server/modules/banner/template-access";
import { drawMatrixBanner, matrixRendererModuleSource } from "@/server/modules/banner/matrix-renderer";

const actor = (...roles: Actor["roles"][number][]): Actor => ({ id: "00000000-0000-4000-8000-000000000001", roles });

describe("template registry", () => {
  it("has exactly two templates: Classic (the default) and Matrix", () => {
    expect([...TEMPLATE_IDS]).toEqual(["classic", "matrix"]);
    expect(TEMPLATE_INFO.classic.label).toBe("ShadowTrix Classic");
    expect(TEMPLATE_INFO.matrix.label).toBe("ShadowTrix Matrix");
    expect(isTemplateId("classic") && isTemplateId("matrix")).toBe(true);
    for (const bad of ["founder", "co-founder", "judge", "participant", "organizer", "MATRIX", "", null, undefined, 3, {}]) expect(isTemplateId(bad)).toBe(false);
  });
});

describe("who may use which template (server-side)", () => {
  it("Matrix is for administrators only: the global admin:access holders", () => {
    expect(canUseMatrix(actor({ role: "ADMIN" }))).toBe(true);
    expect(canUseMatrix(actor({ role: "ADMIN" }, { role: "PARTICIPANT" }))).toBe(true);
    for (const role of ["PARTICIPANT", "TEAM_LEADER", "ORGANIZER", "JUDGE"] as const) expect(canUseMatrix(actor({ role }))).toBe(false);
    expect(canUseMatrix(actor())).toBe(false);
    expect(canUseMatrix(null)).toBe(false);
    expect(canUseMatrix(undefined)).toBe(false);
  });

  it("an event-scoped administrator grant is not platform administration, exactly as for the Admin Panel", () => {
    expect(canUseMatrix(actor({ role: "ADMIN", eventId: "00000000-0000-4000-8000-0000000000aa" }))).toBe(false);
    expect(canUseMatrix(actor({ role: "ADMIN", organizationId: "00000000-0000-4000-8000-0000000000bb" }))).toBe(false);
    expect(availableTemplates(actor({ role: "ADMIN", eventId: "00000000-0000-4000-8000-0000000000aa" })).map((t) => t.id)).toEqual(["classic"]);
  });

  it("the template list never reveals Matrix to anybody else, and lists both for administrators", () => {
    expect(availableTemplates(actor({ role: "PARTICIPANT" })).map((t) => t.id)).toEqual(["classic"]);
    expect(availableTemplates(actor({ role: "ORGANIZER" }, { role: "JUDGE" })).map((t) => t.id)).toEqual(["classic"]);
    expect(availableTemplates(null).map((t) => t.id)).toEqual(["classic"]);
    expect(JSON.stringify(availableTemplates(actor({ role: "PARTICIPANT" })))).not.toMatch(/matrix/i);
    expect(availableTemplates(actor({ role: "ADMIN" })).map((t) => t.id)).toEqual(["classic", "matrix"]);
  });

  it("a requested template is validated and authorized: unknown is 400, Matrix without the permission is 403", () => {
    const admin = actor({ role: "ADMIN" });
    const person = actor({ role: "PARTICIPANT" });
    expect(assertTemplateAllowed(person, "classic")).toBe("classic");
    expect(assertTemplateAllowed(admin, "classic")).toBe("classic");
    expect(assertTemplateAllowed(admin, "matrix")).toBe("matrix");
    expect(() => assertTemplateAllowed(person, "matrix")).toThrowError(expect.objectContaining({ status: 403 }));
    expect(() => assertTemplateAllowed(null, "matrix")).toThrowError(expect.objectContaining({ status: 403 }));
    for (const bad of ["founder", "Matrix", " matrix", "matrix ", "classic,matrix", "", null, undefined, 1, ["matrix"], { id: "matrix" }]) {
      expect(() => assertTemplateAllowed(admin, bad), String(JSON.stringify(bad))).toThrowError(expect.objectContaining({ status: 400 }));
    }
  });
});

/** A canvas context that records what is drawn. measureText behaves like a proportional font. */
function recordingContext() {
  const calls: Record<string, number> = {};
  const texts: { text: string; x: number; y: number }[] = [];
  const state: Record<string | symbol, unknown> = { font: "" };
  const target: Record<string | symbol, unknown> = {};
  const g = new Proxy(target, {
    get(_t, prop) {
      if (prop in state) return state[prop];
      if (prop === "measureText") return (t: string) => ({ width: t.length * (Number(/(\d+)px/.exec(String(state.font))?.[1] ?? 16) * 0.6) });
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => { calls[String(prop)] = (calls[String(prop)] ?? 0) + 1; return { addColorStop() {} }; };
      return (...args: unknown[]) => {
        calls[String(prop)] = (calls[String(prop)] ?? 0) + 1;
        if (prop === "fillText" || prop === "strokeText") texts.push({ text: String(args[0]), x: Number(args[1]), y: Number(args[2]) });
      };
    },
    set(_t, prop, value) { state[prop] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { g, calls, texts };
}

function context(over: Partial<MatrixContext["identity"]> = {}) {
  let portrait = 0, panelText = 0;
  const ctx: MatrixContext = {
    W: 1080, H: 1350, frame: FRAME, panel: PANEL, fontFamily: "sans-serif",
    identity: { ...DEFAULT_BACKGROUND, ...over },
    drawPortrait: () => { portrait++; },
    drawPanelText: () => { panelText++; },
  };
  return { ctx, counts: () => ({ portrait, panelText }) };
}

describe("the Matrix renderer is self-contained server-only code", () => {
  const moduleSource = matrixRendererModuleSource();
  // The delivered text, evaluated in a fresh JavaScript context that has no access to this module, its imports or any browser/host global.
  const loaded = runInNewContext(moduleSource.replace(/^export default /, "").replace(/;\s*$/, "")) as MatrixRenderer;

  it("is delivered as an ES module with a default export", () => {
    expect(moduleSource.startsWith("export default (")).toBe(true);
    expect(moduleSource.trimEnd().endsWith(");")).toBe(true);
    expect(moduleSource.length).toBeGreaterThan(2000);
    expect(typeof loaded).toBe("function");
  });

  it("runs from its source text alone (it uses nothing from the module around it) and draws the whole design", () => {
    const { g, calls, texts } = recordingContext();
    const { ctx, counts } = context({ text: "FOUNDER" });
    loaded(g, ctx);
    expect(counts()).toEqual({ portrait: 1, panelText: 1 }); // the photo and the panel text come from the caller, once each
    expect(calls.fillRect).toBeGreaterThan(0);
    expect(calls.clip).toBeGreaterThanOrEqual(2); // the portrait and the card are clipped to their chamfered shapes
    expect(calls.stroke).toBeGreaterThan(40); // grid, circuit traces and borders
    expect(texts.some((t) => t.text === "FOUNDER")).toBe(true); // the identity text is drawn (decoration)
    expect(texts.some((t) => t.text.replace(/[ ]/g, "") === "SHADOWTRIX")).toBe(true); // the vertical wordmark
  });

  it("is the same function as the source it was serialised from", () => {
    const a = recordingContext(), b = recordingContext();
    loaded(a.g, context({ text: "CO-FOUNDER", size: 140, rotation: 5 }).ctx);
    drawMatrixBanner(b.g, context({ text: "CO-FOUNDER", size: 140, rotation: 5 }).ctx);
    expect(a.calls).toEqual(b.calls);
    expect(a.texts).toEqual(b.texts);
  });

  it("copes with an empty, very long, oversized or invalid identity text", () => {
    for (const over of [{ text: "" }, { text: "   " }, { text: "W".repeat(500) }, { size: 99999 }, { size: -5 }, { rotation: 9999 }, { x: NaN, y: NaN, size: NaN, opacity: NaN, rotation: NaN }, { opacity: 0 }, { x: 50, y: -50 }]) {
      const { g, texts } = recordingContext();
      const { ctx, counts } = context({ text: "SHADOW", ...over });
      expect(() => loaded(g, ctx), JSON.stringify(over)).not.toThrow();
      expect(counts()).toEqual({ portrait: 1, panelText: 1 });
      for (const t of texts) expect(Number.isFinite(t.x) && Number.isFinite(t.y), JSON.stringify(over)).toBe(true);
    }
  });

  it("an empty identity text draws no giant text, and a long one is limited to 24 characters", () => {
    const empty = recordingContext();
    loaded(empty.g, context({ text: "" }).ctx);
    expect(empty.texts.filter((t) => t.text.length > 2 && /^[A-Z\- ]+$/.test(t.text) && !t.text.includes(" "))).toEqual([]);
    const long = recordingContext();
    loaded(long.g, context({ text: "x".repeat(60) }).ctx);
    expect(long.texts.some((t) => t.text === "X".repeat(24))).toBe(true);
    expect(long.texts.some((t) => t.text.length > 24 && /^X+$/.test(t.text))).toBe(false);
  });

  it("the module source does not contain secrets or environment access", () => {
    expect(moduleSource).not.toMatch(/process\.env|require\(|import\(|fetch\(|XMLHttpRequest|localStorage|document\.|window\./);
  });
});
