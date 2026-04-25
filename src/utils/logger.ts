import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.otp",
      "*.otp_hash",
      "*.key_secret",
      "*.refresh_token",
      "*.phone_number",
      "*.email",
      "*.recipient_phone",
      "*.recipient_email",
    ],
    censor: "[REDACTED]",
  },
});
