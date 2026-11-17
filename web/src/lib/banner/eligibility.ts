import { TEMPLATE_IDS, type TemplateId } from "./templates";

/**
 * Which templates a person may be offered. Pure: the server gathers the facts from real records and calls this; nothing here reads
 * free text typed into the editor. A banner is only a picture, but a banner that says "Judge" or "Founder" must not be offered to someone
 * who is neither, so role templates need evidence:
 *  - founder / co-founder: an approved, current position whose title says so (positions come from verified organization membership)
 *  - organizer: an organizer role grant, an event organizer assignment, or an approved organizer position
 *  - judge: a judge role grant or an event judge assignment
 *  - team member: a verified active organization member, or a member of a competition team
 *  - participant: everyone
 */
export interface EligibilityFacts {
  /** Titles of the person's approved, current positions (empty for placeholders, former members and archived positions). */
  designations: readonly string[];
  roles: readonly string[];
  organizesAnEvent: boolean;
  judgesAnEvent: boolean;
  isVerifiedMember: boolean;
  isOnATeam: boolean;
}

const CO_FOUNDER = /\bco[-\s]?founders?\b/i;
const FOUNDER = /\bfounders?\b/i;
const ORGANIZER = /\borgani[sz]ers?\b/i;

export function eligibleTemplates(f: EligibilityFacts): TemplateId[] {
  const has = new Set<TemplateId>(["participant"]);
  if (f.designations.some((d) => CO_FOUNDER.test(d))) has.add("co-founder");
  if (f.designations.some((d) => FOUNDER.test(d) && !CO_FOUNDER.test(d))) has.add("founder");
  if (f.roles.includes("ORGANIZER") || f.organizesAnEvent || f.designations.some((d) => ORGANIZER.test(d))) has.add("organizer");
  if (f.roles.includes("JUDGE") || f.judgesAnEvent) has.add("judge");
  if (f.isVerifiedMember || f.isOnATeam) has.add("team-member");
  return TEMPLATE_IDS.filter((t) => has.has(t));
}
