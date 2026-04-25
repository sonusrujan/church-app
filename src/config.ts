import dotenv from "dotenv";
dotenv.config();

export const PAYMENTS_ENABLED = (process.env.PAYMENTS_ENABLED || "false").toLowerCase() === "true";

const requiredEnv = [
  "DATABASE_URL",
  "JWT_SECRET"
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

export const PORT = Number(process.env.PORT || 4000);
export const APP_NAME = process.env.APP_NAME || "SHALOM";
export const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
export const DATABASE_URL = process.env.DATABASE_URL!;
export const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "";
// MED-10: Secret accessed via process.env directly in consuming modules to avoid
// accidental serialization if the config module is logged.
// Do NOT export RAZORPAY_KEY_SECRET as a constant.
export const JWT_SECRET = process.env.JWT_SECRET!;
export const SMTP_HOST = process.env.SMTP_HOST || "";
export const SMTP_PORT = Number(process.env.SMTP_PORT || 0);
export const SMTP_USER = process.env.SMTP_USER || "";
export const SMTP_PASS = process.env.SMTP_PASS || "";
export const SMTP_FROM = process.env.SMTP_FROM || "";

// AWS SNS configuration (kept for future SMS notifications)
export const AWS_REGION = process.env.AWS_REGION || "ap-south-1";
export const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || "";
export const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || "";
export const OTP_EXPIRY_SECONDS = Number(process.env.OTP_EXPIRY_SECONDS || 300);

// Twilio configuration
export const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
export const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
export const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID || "";
// Messaging Service SID — kept for future bulk SMS use
export const TWILIO_MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID || "";

export const PRIMARY_SUPER_ADMIN_EMAIL = process.env.PRIMARY_SUPER_ADMIN_EMAIL || "";
if (!PRIMARY_SUPER_ADMIN_EMAIL) {
  // Logged at module import time — use process.stderr since logger may not be initialized yet
  process.stderr.write("WARNING: No PRIMARY_SUPER_ADMIN_EMAIL configured in .env\n");
}

const configuredSuperAdminEmails = (process.env.SUPER_ADMIN_EMAILS || PRIMARY_SUPER_ADMIN_EMAIL)
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export const SUPER_ADMIN_EMAILS = Array.from(
  new Set([PRIMARY_SUPER_ADMIN_EMAIL, ...configuredSuperAdminEmails])
);

export const PRIMARY_SUPER_ADMIN_PHONE = process.env.PRIMARY_SUPER_ADMIN_PHONE || "";

const configuredSuperAdminPhones = (process.env.SUPER_ADMIN_PHONES || PRIMARY_SUPER_ADMIN_PHONE)
  .split(",")
  .map((phone) => phone.trim())
  .filter(Boolean);

export const SUPER_ADMIN_PHONES = Array.from(
  new Set([PRIMARY_SUPER_ADMIN_PHONE, ...configuredSuperAdminPhones].filter(Boolean))
);

// Web Push (VAPID) configuration
export const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
export const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
export const VAPID_SUBJECT = process.env.VAPID_SUBJECT || `mailto:${PRIMARY_SUPER_ADMIN_EMAIL || "admin@shalom.app"}`;
