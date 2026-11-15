/**
 * Password length limits: the single source of truth, imported by the server validation (auth.schema.ts)
 * and by the form hints in the browser, so the two can never disagree.
 *
 * Minimum 12 (owner-approved policy). Maximum 128 bounds Argon2 work per request.
 * Length is counted in UTF-16 code units, like the server check; there are no composition rules.
 */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export const PASSWORD_HINT = `At least ${PASSWORD_MIN} characters. A few random words make a strong passphrase.`;
