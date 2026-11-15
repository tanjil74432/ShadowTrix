import { z } from "zod";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/password-policy";
import { normalizeEmail } from "@/server/security/tokens";

/**
 * The few passwords people actually choose. Not exhaustive: the length rule plus this list blocks the worst cases.
 * Entries shorter than the minimum are kept out on purpose (the length rule already rejects them).
 */
const COMMON_PASSWORDS = new Set([
  "administrator", "adminadmin123", "changeme1234", "password1234", "passwordpassword", "password12345",
  "123456789012", "1234567890123", "111111111111", "000000000000", "qwertyuiop12", "qwertyuiop123",
  "iloveyou1234", "welcome12345", "letmein123456", "shadowtrix123", "shadowtrix1234", "teameushadow",
]);

export { PASSWORD_MAX, PASSWORD_MIN };

export function passwordIssues(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return "That password is too common. Try a longer passphrase.";
  if (/^(.)\1+$/.test(password)) return "Do not repeat a single character.";
  if (email) {
    const local = normalizeEmail(email).split("@")[0];
    if (local.length >= 4 && lower.includes(local)) return "Do not include your email address in your password.";
  }
  return null;
}

const email = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .max(254, "That email address is too long.")
  .pipe(z.email("Enter an email address in the format name@example.com."))
  .transform(normalizeEmail);

const newPassword = z.string().min(1, "Enter a password.").max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`);

const fullName = z
  .string()
  .trim()
  .min(2, "Enter your full name.")
  .max(100, "Use at most 100 characters.")
  .refine((v) => !/[\u0000-\u001f<>]/.test(v), "Remove special characters from your name.");

const token = z.string().trim().min(20, "This link is not valid.").max(200, "This link is not valid.");

/** Step 1 of signup: only an email address. No name and no password are accepted until the mailbox is proven. */
export const registerSchema = z.object({ email });

/** Step 2: the owner of the mailbox, holding the emailed token, chooses a name and password. */
export const completeRegistrationSchema = z.object({ token, fullName, password: newPassword }).superRefine((v, ctx) => {
  const issue = passwordIssues(v.password);
  if (issue) ctx.addIssue({ code: "custom", path: ["password"], message: issue });
});

// Login never reveals password rules; only that something is required.
export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(PASSWORD_MAX),
});

/** Signed-in password change: the current password proves the person at the keyboard is the account owner. */
export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, "Enter your current password.").max(PASSWORD_MAX), newPassword })
  .superRefine((v, ctx) => {
    const issue = passwordIssues(v.newPassword);
    if (issue) ctx.addIssue({ code: "custom", path: ["newPassword"], message: issue });
  });

export const emailOnlySchema = z.object({ email });
export const tokenSchema = z.object({ token });
export const resetPasswordSchema = z.object({ token, password: newPassword }).superRefine((v, ctx) => {
  const issue = passwordIssues(v.password);
  if (issue) ctx.addIssue({ code: "custom", path: ["password"], message: issue });
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type CompleteRegistrationInput = z.infer<typeof completeRegistrationSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
