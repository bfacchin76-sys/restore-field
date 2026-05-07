import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";
import { logger } from "./logger";

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let cachedTransport: Transporter | null = null;

function buildTransport(): Transporter {
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }
  // Dev fallback: log to stdout instead of sending. PRD §14 Phase 1
  // explicitly accepts a console transporter for now.
  return nodemailer.createTransport({
    streamTransport: true,
    newline: "unix",
    buffer: true,
  });
}

function getTransport(): Transporter {
  if (!cachedTransport) cachedTransport = buildTransport();
  return cachedTransport;
}

export async function sendMail(input: SendMailInput): Promise<void> {
  const transport = getTransport();
  const result = await transport.sendMail({
    from: env.SMTP_FROM,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });

  if (!env.SMTP_HOST) {
    logger.info(
      { to: input.to, subject: input.subject, body: input.text },
      "[mailer:dev] email captured (no SMTP configured)",
    );
  } else {
    logger.info(
      { to: input.to, subject: input.subject, messageId: result.messageId },
      "[mailer] email sent",
    );
  }
}
