import type { Mail } from "./mailer";
import { escapeHtml } from "./mailer";

/**
 * Transactional emails. Rules: plain, no tracking pixels, no emojis, links go only to our own APP_URL,
 * user-supplied text is HTML-escaped, and emails never contain passwords.
 */
function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="en"><body style="margin:0;background:#000;color:#fafafa;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0a0a0a;border:1px solid #262626;border-radius:8px">
<tr><td style="padding:32px"><h1 style="margin:0 0 16px;font-size:22px;color:#fafafa">${escapeHtml(title)}</h1>${bodyHtml}
<p style="margin:32px 0 0;font-size:13px;color:#a3a3a3">ShadowTrix, operated by Team EU Shadow</p></td></tr></table></td></tr></table></body></html>`;
}

const p = (html: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#d4d4d4">${html}</p>`;
const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#fff;color:#000;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:6px;display:inline-block">${escapeHtml(label)}</a></p>` +
  p(`If the button does not work, copy this address into your browser:<br><span style="word-break:break-all;color:#a3a3a3">${escapeHtml(href)}</span>`);

export function verificationEmail(to: string, link: string, ttlHours: number): Mail {
  return {
    to,
    subject: "Confirm your email address for ShadowTrix",
    text: `Hello,\n\nSomeone asked to create a ShadowTrix account with this email address. Open the link below to confirm it is yours and choose a password.\n\n${link}\n\nThis link works once and expires in ${ttlHours} hours. If this was not you, ignore this email; no account will be activated.`,
    html: layout(
      "Confirm your email address",
      p("Hello,") +
        p("Someone asked to create a ShadowTrix account with this email address. Confirm it is yours and choose your password.") +
        button(link, "Confirm email and choose password") +
        p(`This link works once and expires in ${ttlHours} hours. If this was not you, ignore this email; no account will be activated.`),
    ),
  };
}

/** Sent when someone tries to register an address that already has a verified account. */
export function alreadyRegisteredEmail(to: string, name: string, loginUrl: string, resetUrl: string): Mail {
  return {
    to,
    subject: "You already have a ShadowTrix account",
    text: `Hello ${name},\n\nSomeone tried to create a ShadowTrix account with this email address, but an account already exists.\n\nLog in: ${loginUrl}\nForgot your password: ${resetUrl}\n\nIf this was not you, no action is needed.`,
    html: layout(
      "You already have an account",
      p(`Hello ${escapeHtml(name)},`) +
        p("Someone tried to create a ShadowTrix account with this email address, but an account already exists.") +
        button(loginUrl, "Log in") +
        p(`Forgot your password? <a href="${escapeHtml(resetUrl)}" style="color:#fff">Reset it here</a>. If this was not you, no action is needed.`),
    ),
  };
}

export function passwordResetEmail(to: string, name: string, link: string, ttlMinutes: number): Mail {
  return {
    to,
    subject: "Reset your ShadowTrix password",
    text: `Hello ${name},\n\nUse this link to choose a new password:\n${link}\n\nThe link works once and expires in ${ttlMinutes} minutes. If you did not ask for this, ignore this email; your password has not changed.`,
    html: layout(
      "Reset your password",
      p(`Hello ${escapeHtml(name)},`) +
        p("Use the button below to choose a new password.") +
        button(link, "Choose a new password") +
        p(`The link works once and expires in ${ttlMinutes} minutes. If you did not ask for this, ignore this email; your password has not changed.`),
    ),
  };
}

export function teamInvitationEmail(to: string, inviterName: string, teamName: string, eventTitle: string, link: string, ttlDays: number): Mail {
  return {
    to,
    subject: `${inviterName} invited you to join a team on ShadowTrix`,
    text: `Hello,\n\n${inviterName} invited you to join the team "${teamName}" for the event "${eventTitle}" on ShadowTrix.\n\nOpen this link, log in with this email address, and choose to accept or decline:\n\n${link}\n\nThe invitation works once and expires in ${ttlDays} days. If you do not know ${inviterName}, ignore this email.`,
    html: layout(
      "You were invited to join a team",
      p("Hello,") +
        p(`${escapeHtml(inviterName)} invited you to join the team <strong>${escapeHtml(teamName)}</strong> for <strong>${escapeHtml(eventTitle)}</strong>.`) +
        button(link, "View the invitation") +
        p(`Log in with this email address to accept or decline. The invitation expires in ${ttlDays} days. If you do not know ${escapeHtml(inviterName)}, ignore this email.`),
    ),
  };
}

export function passwordChangedEmail(to: string, name: string, resetUrl: string): Mail {
  return {
    to,
    subject: "Your ShadowTrix password was changed",
    text: `Hello ${name},\n\nThe password for your ShadowTrix account was just changed and all devices were signed out.\n\nIf this was not you, reset your password right away: ${resetUrl}`,
    html: layout(
      "Your password was changed",
      p(`Hello ${escapeHtml(name)},`) +
        p("The password for your ShadowTrix account was just changed and all devices were signed out.") +
        p(`If this was not you, <a href="${escapeHtml(resetUrl)}" style="color:#fff">reset your password right away</a>.`),
    ),
  };
}
