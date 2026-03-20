import nodemailer from "nodemailer";
import {
  APP_NAME,
  SMTP_FROM,
  SMTP_HOST,
  SMTP_PASS,
  SMTP_PORT,
  SMTP_USER,
} from "../config";
import { logger } from "../utils/logger";

let cachedTransporter: nodemailer.Transporter | null = null;

function hasMailerConfig() {
  return Boolean(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && SMTP_FROM);
}

function getTransporter() {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  cachedTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  return cachedTransporter;
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}) {
  if (!hasMailerConfig()) {
    return {
      delivered: false,
      note: `${APP_NAME} mailer not configured`,
    };
  }

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: SMTP_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });

    return {
      delivered: true,
      note: "Email delivered",
    };
  } catch (error) {
    logger.error({ err: error, to: input.to }, "sendEmail failed");
    return {
      delivered: false,
      note: error instanceof Error ? error.message : "Email send failed",
    };
  }
}
