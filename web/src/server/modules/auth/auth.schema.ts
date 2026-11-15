import { z } from "zod";
import { normalizeEmail } from "@/server/security/tokens";

/** The few passwords people actually choose. Not exhaustive: a length rule plus this list blocks the worst cases. */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "123456789", "1234567890", "12345678910",
  "qwertyuiop", "qwerty123", "qwertyuiop123", "1q2w3e4r5t", "iloveyou123", "letmein123", "welcome123",
  "administrator", "adminadmin", "admin12345", "changeme123", "abc1234567", "111111111111", "000000000000",
  "shadowtrix", "shadowtrix1", "shadowtrix123", "teameushadow",
]);

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

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

export const registerSchema = z
  .object({ email, fullName, password: newPassword })
  .superRefine((v, ctx) => {
    const issue = passwordIssues(v.password, v.email);
    if (issue) ctx.addIssue({ code: "custom", path: ["password"], message: issue });
  });

// Login never reveals password rules; only that something is required.
export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(PASSWORD_MAX),
});

export const emailOnlySchema = z.object({ email });
export const tokenSchema = z.object({ token });
export const resetPasswordSchema = z.object({ token, password: newPassword }).superRefine((v, ctx) => {
  const issue = passwordIssues(v.password);
  if (issue) ctx.addIssue({ code: "custom", path: ["password"], message: issue });
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
