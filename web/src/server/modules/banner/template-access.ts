import "server-only";
import { badRequest, forbidden } from "@/server/http/errors";
import { can, type Actor } from "@/server/modules/authz/permissions";
import { TEMPLATE_INFO, isTemplateId, type TemplateId, type TemplateInfo } from "@/lib/banner/template-registry";

/**
 * Who may use which banner template. Reuses the existing permission system and grants nothing new:
 *  - classic: every signed-in user;
 *  - matrix: administrators only, i.e. the holders of the global `admin:access` permission (an event-scoped administrator grant is not enough,
 *    exactly as for the Admin Panel).
 * Every server operation that touches a template (the page, the template list, the renderer download and the export check) goes through here,
 * so the decision is never made by the browser.
 */
export function canUseMatrix(actor: Actor | null | undefined): boolean {
  return can(actor, "admin:access");
}

/** The templates this person may use. Matrix is never listed for anybody else, so no response reveals it to them. */
export function availableTemplates(actor: Actor | null | undefined): TemplateInfo[] {
  return canUseMatrix(actor) ? [TEMPLATE_INFO.classic, TEMPLATE_INFO.matrix] : [TEMPLATE_INFO.classic];
}

/** Validates a requested template and refuses it unless the actor may use it: 400 for an unknown name, 403 for Matrix without the permission. */
export function assertTemplateAllowed(actor: Actor | null | undefined, requested: unknown): TemplateId {
  if (!isTemplateId(requested)) throw badRequest("unknown_template", "Unknown banner template");
  if (requested === "matrix" && !canUseMatrix(actor)) throw forbidden();
  return requested;
}
