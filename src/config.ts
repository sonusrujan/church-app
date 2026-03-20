import dotenv from "dotenv";
dotenv.config();

export const PAYMENTS_ENABLED = (process.env.PAYMENTS_ENABLED || "false").toLowerCase() === "true";

const requiredEnv = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
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
export const SUPABASE_URL = process.env.SUPABASE_URL!;
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
export const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "";
export const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
export const JWT_SECRET = process.env.JWT_SECRET!;
export const SMTP_HOST = process.env.SMTP_HOST || "";
export const SMTP_PORT = Number(process.env.SMTP_PORT || 0);
export const SMTP_USER = process.env.SMTP_USER || "";
export const SMTP_PASS = process.env.SMTP_PASS || "";
export const SMTP_FROM = process.env.SMTP_FROM || "";
export const PRIMARY_SUPER_ADMIN_EMAIL = "sonusrujan76@gmail.com";

const configuredSuperAdminEmails = (process.env.SUPER_ADMIN_EMAILS || PRIMARY_SUPER_ADMIN_EMAIL)
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export const SUPER_ADMIN_EMAILS = Array.from(
  new Set([PRIMARY_SUPER_ADMIN_EMAIL, ...configuredSuperAdminEmails])
);
