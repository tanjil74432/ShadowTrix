import { z } from "zod";

import { stripNul } from "@/lib/sanitize";

export const EVENT_CATEGORY_VALUES = ["HACKATHON", "DATATHON", "AI_ML", "PROGRAMMING_CONTEST", "WORKSHOP", "SUMMIT", "INNOVATION_CHALLENGE", "OTHER"] as const;
export const LOCATION_TYPES = ["ONLINE", "ONSITE", "HYBRID"] as const;

const noControl = (v: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/.test(v);
const text = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label} must be at least ${min} characters.`).max(max, `${label} must be at most ${max} characters.`).refine(noControl, `${label} contains characters that are not allowed.`);

/** An ISO date-time. Forms send UTC ("...Z"); anything unparseable is rejected. */
const when = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid date and time.")
  .transform((v) => new Date(v));
const optionalWhen = z
  .union([when, z.literal("").transform(() => null), z.null()])
  .optional();

const base = {
  title: text(3, 120, "The title"),
  category: z.enum(EVENT_CATEGORY_VALUES, { message: "Choose a category." }),
  summary: text(10, 300, "The summary"),
  description: text(20, 10_000, "The description"),
  startsAt: when,
  endsAt: when,
  registrationOpensAt: when,
  registrationClosesAt: when,
  submissionDeadline: optionalWhen,
  judgingStartsAt: optionalWhen,
  judgingEndsAt: optionalWhen,
  resultsAnnouncementAt: optionalWhen,
  capacity: z
    .union([z.coerce.number().int("Capacity must be a whole number.").min(1, "Capacity must be at least 1.").max(100_000, "Capacity is too large."), z.literal("").transform(() => null), z.null()])
    .optional(),
  locationType: z.enum(LOCATION_TYPES).default("ONLINE"),
  registrationMode: z.enum(["INDIVIDUAL", "TEAM"], { message: "Choose individual or team registration." }).optional(),
  minTeamSize: z.union([z.coerce.number().int("Use a whole number.").min(1, "At least 1.").max(50, "At most 50."), z.literal("").transform(() => null), z.null()]).optional(),
  maxTeamSize: z.union([z.coerce.number().int("Use a whole number.").min(1, "At least 1.").max(50, "At most 50."), z.literal("").transform(() => null), z.null()]).optional(),
  location: z.union([text(1, 200, "The location"), z.literal("").transform(() => null), z.null()]).optional(),
  eligibility: z.union([text(1, 1000, "Eligibility"), z.literal("").transform(() => null), z.null()]).optional(),
};

type TeamFields = { registrationMode?: "INDIVIDUAL" | "TEAM"; minTeamSize?: number | null; maxTeamSize?: number | null };

/** Mirrors events_team_size_chk. Team events need both limits, with max at least min. */
export function teamIssues(d: TeamFields): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (d.registrationMode === "TEAM") {
    if (d.minTeamSize == null) issues.push({ path: "minTeamSize", message: "Team events need a minimum team size." });
    if (d.maxTeamSize == null) issues.push({ path: "maxTeamSize", message: "Team events need a maximum team size." });
    if (d.minTeamSize != null && d.maxTeamSize != null && d.maxTeamSize < d.minTeamSize) issues.push({ path: "maxTeamSize", message: "The maximum cannot be smaller than the minimum." });
  }
  return issues;
}

type Dates = {
  startsAt?: Date; endsAt?: Date; registrationOpensAt?: Date; registrationClosesAt?: Date;
  submissionDeadline?: Date | null; judgingStartsAt?: Date | null; judgingEndsAt?: Date | null; resultsAnnouncementAt?: Date | null;
};

/** Mirrors the database CHECK constraints so people get a field-level message instead of a failed insert. */
export function timelineIssues(d: Dates): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const { startsAt, endsAt, registrationOpensAt: opens, registrationClosesAt: closes } = d;
  if (startsAt && endsAt && endsAt <= startsAt) issues.push({ path: "endsAt", message: "The event must end after it starts." });
  if (opens && closes && closes < opens) issues.push({ path: "registrationClosesAt", message: "Registration must close after it opens." });
  if (closes && endsAt && closes > endsAt) issues.push({ path: "registrationClosesAt", message: "Registration cannot close after the event ends." });
  if (d.submissionDeadline && startsAt && d.submissionDeadline < startsAt) issues.push({ path: "submissionDeadline", message: "The submission deadline cannot be before the event starts." });
  if (d.judgingStartsAt && d.judgingEndsAt && d.judgingEndsAt < d.judgingStartsAt) issues.push({ path: "judgingEndsAt", message: "Judging must end after it starts." });
  if (d.judgingStartsAt && d.submissionDeadline && d.judgingStartsAt < d.submissionDeadline) issues.push({ path: "judgingStartsAt", message: "Judging cannot start before the submission deadline." });
  return issues;
}

const withTimeline = <T extends z.ZodType<Dates & TeamFields>>(schema: T) =>
  schema.superRefine((v, ctx) => {
    for (const i of [...timelineIssues(v), ...teamIssues(v)]) ctx.addIssue({ code: "custom", path: [i.path], message: i.message });
  });

/** Unknown keys (slug, status, createdById, ...) are dropped. Team events (registrationMode TEAM) need min and max team size. */
export const createEventSchema = withTimeline(z.object(base));
export const updateEventSchema = withTimeline(z.object(base).partial());

export const eventStatusActionSchema = z.object({ action: z.enum(["publish", "unpublish", "cancel", "archive"]) });

export const listEventsQuerySchema = z.object({
  q: z.string().transform(stripNul).pipe(z.string().trim().max(100)).optional(),
  category: z.enum(EVENT_CATEGORY_VALUES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type EventStatusAction = z.infer<typeof eventStatusActionSchema>["action"];
