/**
 * The banner has exactly two templates. This module holds names only (no drawing code), so it is safe to import anywhere.
 *
 *  - classic: the default for every signed-in user.
 *  - matrix:  Administrators only. Who may use it is decided on the SERVER (see server/modules/banner/template-access.ts):
 *             the page only receives the templates the signed-in person may use, and the code that draws the Matrix design is
 *             delivered by an endpoint that refuses everybody else.
 */
export const TEMPLATE_IDS = ["classic", "matrix"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface TemplateInfo {
  id: TemplateId;
  label: string;
  description: string;
}

export const TEMPLATE_INFO: Record<TemplateId, TemplateInfo> = {
  classic: { id: "classic", label: "ShadowTrix Classic", description: "The standard ShadowTrix banner." },
  matrix: { id: "matrix", label: "ShadowTrix Matrix", description: "Premium Matrix design (administrators only)." },
};

export const DEFAULT_TEMPLATE: TemplateId = "classic";

export const isTemplateId = (value: unknown): value is TemplateId => typeof value === "string" && (TEMPLATE_IDS as readonly string[]).includes(value);

/** Where the editor loads the Matrix drawing code from. The endpoint answers 401/403 unless the caller is an administrator. */
export const MATRIX_RENDERER_URL = "/api/v1/banner/templates/matrix/renderer";
export const TEMPLATES_URL = "/api/v1/banner/templates";
export const EXPORT_CHECK_URL = "/api/v1/banner/template-access";
