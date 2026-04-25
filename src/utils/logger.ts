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
      "*.phone",
      "*.phone_number",
      "*.email",
      "*.recipient_phone",
      "*.recipient_email",
      // LOW-008: Wildcard paths to catch nested sensitive data
      "*.*.password",
      "*.*.secret",
      "*.*.token",
      "*.*.refresh_token",
      "*.*.authorization",
      "*.*.cookie",
      "*.*.key_secret",
    ],
    censor: "[REDACTED]",
  },
});
