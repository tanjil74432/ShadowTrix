/**
 * The six banner templates. Pure data, safe to import from the browser and from server code. Colours are the ShadowTrix brand palette only.
 * A template changes how the banner LOOKS and which role badge it carries; which templates a person may pick is decided on the server
 * from their real records (see eligibility.ts), never from anything typed into the editor.
 */
export const TEMPLATE_IDS = ["founder", "co-founder", "organizer", "participant", "team-member", "judge"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export type FrameStyle = "double" | "brackets" | "solid" | "notch";
export type Motif = "halo" | "diagonal" | "grid" | "none" | "network" | "scan";

export interface TemplateSpec {
  id: TemplateId;
  /** Shown in the editor. */
  label: string;
  /** Printed on the banner (upper case). */
  badge: string;
  description: string;
  /** Badge fill and accent colours (brand palette). */
  accent: string;
  accentSoft: string;
  frame: FrameStyle;
  motif: Motif;
  /** Where the main ambient light sits, as fractions of the banner. */
  glow: { x: number; y: number };
  /** Filled badge (a held role) or outlined badge (open to everyone). */
  badgeFilled: boolean;
}

export const TEMPLATES: Record<TemplateId, TemplateSpec> = {
  founder: { id: "founder", label: "Founder", badge: "FOUNDER", description: "For the founder of ShadowTrix.", accent: "#d95f1b", accentSoft: "#ff9a55", frame: "double", motif: "halo", glow: { x: 0.5, y: 0.05 }, badgeFilled: true },
  "co-founder": { id: "co-founder", label: "Co-Founder", badge: "CO-FOUNDER", description: "For a co-founder of ShadowTrix.", accent: "#d95f1b", accentSoft: "#ff9a55", frame: "double", motif: "diagonal", glow: { x: 0.95, y: 0.1 }, badgeFilled: true },
  organizer: { id: "organizer", label: "Organizer", badge: "ORGANIZER", description: "For people who organize ShadowTrix events.", accent: "#f07832", accentSoft: "#ff9a55", frame: "brackets", motif: "grid", glow: { x: 0.05, y: 0.55 }, badgeFilled: true },
  participant: { id: "participant", label: "Participant", badge: "PARTICIPANT", description: "Open to every member.", accent: "#f07832", accentSoft: "#ff9a55", frame: "solid", motif: "none", glow: { x: 0.95, y: 0.93 }, badgeFilled: false },
  "team-member": { id: "team-member", label: "Team member", badge: "TEAM MEMBER", description: "For verified team members.", accent: "#f07832", accentSoft: "#ff9a55", frame: "notch", motif: "network", glow: { x: 0.9, y: 0.4 }, badgeFilled: true },
  judge: { id: "judge", label: "Judge", badge: "JUDGE", description: "For event judges.", accent: "#d95f1b", accentSoft: "#ff9a55", frame: "brackets", motif: "scan", glow: { x: 0.1, y: 0.1 }, badgeFilled: true },
};

export const isTemplateId = (v: unknown): v is TemplateId => typeof v === "string" && (TEMPLATE_IDS as readonly string[]).includes(v);
