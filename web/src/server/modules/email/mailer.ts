import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { getEnv } from "@/server/config/env";

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
    await transporter.sendMail({ from: env.EMAIL_FROM, ...mail });
  },
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
