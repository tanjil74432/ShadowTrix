import { z } from "zod";
import { httpsUrl } from "@/server/modules/submissions/submissions.schema";

const noControl = (v: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/.test(v);
const text = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label} must be at least ${min} characters.`).max(max, `${label} must be at most ${max} characters.`).refine(noControl, `${label} contains characters that are not allowed.`);
const optText = (max: number, label: string) => z.union([text(1, max, label), z.literal("").transform(() => null), z.null()]).optional();
const optUrl = z.union([httpsUrl, z.literal("").transform(() => null), z.null()]).optional();
const optDate = z.union([z.iso.date().transform((d) => new Date(`${d}T00:00:00Z`)), z.literal("").transform(() => null), z.null()]).optional();

export const organizationSchema = z.object({
  name: text(2, 120, "The name"),
  type: z.enum(["PLATFORM_OPERATOR", "UNIVERSITY", "COMMUNITY", "COMPANY", "OTHER"]).default("OTHER"),
  description: optText(1000, "The description"),
  websiteUrl: optUrl,
});
export const organizationUpdateSchema = organizationSchema.partial();

export const memberSchema = z.object({
  fullName: text(2, 100, "The name"),
  bio: optText(1000, "The bio"),
  department: optText(100, "The department"),
  responsibilities: optText(1000, "The responsibilities"),
  linkedinUrl: optUrl,
  githubUrl: optUrl,
  portfolioUrl: optUrl,
  email: z.union([z.string().trim().max(254).pipe(z.email("Enter an email address in the format name@example.com.")).transform((e) => e.toLowerCase()), z.literal("").transform(() => null), z.null()]).optional(),
  emailPublic: z.boolean().default(false),
  skills: z.array(text(1, 40, "A skill")).max(20, "At most 20 skills.").default([]),
  status: z.enum(["ACTIVE", "FORMER"]).default("ACTIVE"),
  visibility: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
  /** True until an administrator confirms the details were verified. Placeholder members are never shown publicly. */
  isPlaceholder: z.boolean().default(true),
});
export const memberUpdateSchema = memberSchema.partial();

export const membershipSchema = z.object({
  unitId: z.uuid(),
  designationId: z.uuid(),
  termId: z.union([z.uuid(), z.literal("").transform(() => null), z.null()]).optional(),
  startedOn: optDate,
  endedOn: optDate,
  displayOrder: z.coerce.number().int().min(0).max(10_000).default(0),
});
export const membershipUpdateSchema = membershipSchema.partial().extend({ isArchived: z.boolean().optional() });

export const termSchema = z.object({
  label: text(2, 60, "The label"),
  startsOn: z.iso.date().transform((d) => new Date(`${d}T00:00:00Z`)),
  endsOn: optDate,
  isCurrent: z.boolean().default(false),
});
export const termUpdateSchema = termSchema.partial();

export const unitSchema = z.object({ name: text(2, 80, "The name"), description: optText(300, "The description"), displayOrder: z.coerce.number().int().min(0).max(1000).default(0) });
export const designationSchema = z.object({ title: text(2, 80, "The title"), rankOrder: z.coerce.number().int().min(0).max(10_000).default(1000) });

export const hostSchema = z.object({ organizationId: z.uuid(), role: z.enum(["HOST", "CO_HOST", "PARTNER"]).default("HOST") });
export const emailSchema = z.object({ email: z.string().trim().min(1).max(254).pipe(z.email("Enter an email address in the format name@example.com.")) });
export const verifySchema = z.object({ verified: z.boolean() });
