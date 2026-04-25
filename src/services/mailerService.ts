import nodemailer from "nodemailer";
import {
  APP_NAME,
  SMTP_FROM,
  SMTP_HOST,
  SMTP_PASS,
  SMTP_PORT,
  SMTP_USER,
} from "../config";
import { AWS_REGION } from "../config";
import { logger } from "../utils/logger";

let cachedTransporter: nodemailer.Transporter | null = null;

function hasMailerConfig() {
  return Boolean(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && SMTP_FROM);
}

// 8.1: Check if SES SDK can be used (via IAM role or explicit keys)
function hasSESConfig() {
  return Boolean(AWS_REGION && SMTP_FROM);
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

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]/g, "").trim();
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}) {
  // Sanitize headers to prevent email header injection
  const safeTo = sanitizeHeader(input.to);
  const safeSubject = sanitizeHeader(input.subject);

  // Try SMTP first
  if (hasMailerConfig()) {
    try {
      const transporter = getTransporter();
      await transporter.sendMail({
        from: SMTP_FROM,
        to: safeTo,
        subject: safeSubject,
        text: input.text,
        html: input.html,
      });

      return { delivered: true, note: "Email delivered via SMTP" };
    } catch (error) {
      logger.error({ err: error, to: input.to }, "sendEmail SMTP failed");
      // Fall through to SES
    }
  }

  // 8.1: Fallback to AWS SES SDK
  if (hasSESConfig()) {
    try {
      const { SESClient, SendEmailCommand } = await import("@aws-sdk/client-ses");
      const sesClient = new SESClient({
        region: AWS_REGION,
        ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? { credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY } }
          : {}),
      });

      await sesClient.send(new SendEmailCommand({
        Source: SMTP_FROM,
        Destination: { ToAddresses: [safeTo] },
        Message: {
          Subject: { Data: safeSubject, Charset: "UTF-8" },
          Body: {
            Text: { Data: input.text, Charset: "UTF-8" },
            ...(input.html ? { Html: { Data: input.html, Charset: "UTF-8" } } : {}),
          },
        },
      }));

      return { delivered: true, note: "Email delivered via SES" };
    } catch (error) {
      logger.error({ err: error, to: input.to }, "sendEmail SES failed");
      return {
        delivered: false,
        note: error instanceof Error ? error.message : "SES email send failed",
      };
    }
  }

  return {
    delivered: false,
    note: `${APP_NAME} mailer not configured — set SMTP credentials or ensure SES access`,
  };
}
