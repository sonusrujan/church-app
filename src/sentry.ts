import * as Sentry from "@sentry/node";
import { logger } from "./utils/logger";

const SENTRY_DSN = process.env.SENTRY_DSN || "";

export function initSentry() {
  if (!SENTRY_DSN) {
    logger.warn("SENTRY_DSN not configured — error tracking disabled");
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    release: process.env.APP_VERSION || "unknown",
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.3"),
    beforeSend(event) {
      // Scrub PII from error events
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
      }
      return event;
    },
  });

  logger.info("Sentry error tracking initialized");
}

export { Sentry };
