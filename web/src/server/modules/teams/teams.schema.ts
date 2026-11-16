import { z } from "zod";
import { normalizeEmail } from "@/server/security/tokens";

const noControl = (v: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/.test(v);

export const createTeamSchema = z.object({
  name: z.string().trim().min(2, "The team name must be at least 2 characters.").max(60, "The team name must be at most 60 characters.").refine(noControl, "The team name contains characters that are not allowed."),
  description: z
    .union([z.string().trim().min(1).max(500, "The description must be at most 500 characters.").refine(noControl, "The description contains characters that are not allowed."), z.literal("").transform(() => null), z.null()])
    .optional(),
});
export const updateTeamSchema = createTeamSchema.partial();

export const inviteSchema = z.object({
  email: z.string().trim().min(1, "Enter an email address.").max(254).pipe(z.email("Enter an email address in the format name@example.com.")).transform(normalizeEmail),
});

export const invitationResponseSchema = z.object({ accept: z.boolean() });
export const invitationTokenSchema = z.object({ token: z.string().trim().min(20).max(200) });

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
