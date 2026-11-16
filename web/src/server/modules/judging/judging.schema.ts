import { z } from "zod";
import { normalizeEmail } from "@/server/security/tokens";
import { hasAtMostTwoDecimals } from "./scoring";

const noControl = (v: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/.test(v);

export const criterionSchema = z.object({
  name: z.string().trim().min(2, "The name must be at least 2 characters.").max(80, "The name must be at most 80 characters.").refine(noControl, "The name contains characters that are not allowed."),
  description: z.union([z.string().trim().min(1).max(300, "The description must be at most 300 characters.").refine(noControl, "The description contains characters that are not allowed."), z.literal("").transform(() => null), z.null()]).optional(),
  maxScore: z.coerce.number("Enter a number.").gt(0, "The maximum must be greater than 0.").max(1000, "The maximum must be at most 1000.").refine(hasAtMostTwoDecimals, "Use at most 2 decimals."),
  weight: z.coerce.number("Enter a number.").gt(0, "The weight must be greater than 0.").max(100, "The weight must be at most 100.").refine((x) => Math.abs(Math.round(x * 1000) - x * 1000) < 1e-9, "Use at most 3 decimals.").default(1),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
});
export const criterionUpdateSchema = criterionSchema.partial();

export const assignJudgeSchema = z.object({ email: z.string().trim().min(1, "Enter an email address.").max(254).pipe(z.email("Enter an email address in the format name@example.com.")).transform(normalizeEmail) });

export const scorecardSchema = z.object({
  scores: z
    .array(
      z.object({
        criterionId: z.uuid(),
        score: z.number("Enter a number.").min(0, "A score cannot be negative.").refine(hasAtMostTwoDecimals, "Use at most 2 decimals."),
        feedback: z.union([z.string().trim().max(2000, "Feedback must be at most 2000 characters.").refine(noControl, "Feedback contains characters that are not allowed."), z.literal("").transform(() => null), z.null()]).optional(),
      }),
    )
    .min(1, "Enter at least one score.")
    .max(50),
  finalize: z.boolean().default(false),
});

export const reasonSchema = z.object({ reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(500, "The reason must be at most 500 characters.") });

export type CriterionInput = z.infer<typeof criterionSchema>;
export type ScorecardInput = z.infer<typeof scorecardSchema>;
