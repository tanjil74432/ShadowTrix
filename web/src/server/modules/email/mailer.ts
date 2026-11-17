import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { getEnv } from "@/server/config/env";
import { writeAudit } from "@/server/modules/audit/audit.service";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

let transporter: Transporter | undefined;

/** SMTP transport configured from env (Mailpit in development; any SMTP provider elsewhere). */
export const smtpMailer: Mailer = {
  async send(mail) {
    const env = getEnv();
    transporter ??= nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
    const info = await transporter.sendMail({ from: env.EMAIL_FROM, ...mail });
    // Proof of provider acceptance for administrators: the SMTP reply code and counts only (never an address, a message id or text).
    // Acceptance is not inbox delivery: the provider can still filter the message.
    const code = Number(String(info.response ?? "").slice(0, 3));
    await writeAudit({ actorId: null, action: "email.delivered", entityType: "system", entityId: "email", after: { responseCode: Number.isInteger(code) && code >= 200 && code <= 299 ? code : null, accepted: info.accepted?.length ?? 0, rejected: info.rejected?.length ?? 0 } }).catch(() => undefined);
  },
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
