import * as Sentry from "@sentry/react";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || "";
const APP_VERSION = import.meta.env.VITE_APP_VERSION || "unknown";
const ENV = import.meta.env.MODE || "development";

/**
 * PII strings we always scrub from breadcrumbs and error bodies
 * before shipping to Sentry. Extend with care.
 */
const PII_PATTERNS: RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // emails
  /\+?\d{10,13}/g, // phone numbers (Indian mobile variants)
  /\b(?:\d[ -]*?){13,19}\b/g, // card numbers
];

function scrub(value: unknown): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const re of PII_PATTERNS) out = out.replace(re, "[REDACTED]");
    return out;
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (/token|password|secret|cookie|authorization/i.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = scrub(v);
      }
    }
    return out;
  }
  return value;
}

export function initSentry() {
  if (!SENTRY_DSN) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ENV,
    release: APP_VERSION,
    tracesSampleRate: ENV === "production" ? 0.1 : 0.5,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: ENV === "production" ? 0.5 : 0,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    beforeSend(event) {
      if (event.message) event.message = String(scrub(event.message));
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => ({
          ...b,
          message: b.message ? String(scrub(b.message)) : b.message,
          data: b.data ? (scrub(b.data) as Record<string, unknown>) : b.data,
        }));
      }
      if (event.request?.url) {
        event.request.url = String(scrub(event.request.url));
      }
      if (event.extra) event.extra = scrub(event.extra) as Record<string, unknown>;
      return event;
    },
    ignoreErrors: [
      // Expected browser noise
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      "Non-Error promise rejection captured",
      /Network request failed/i,
      /Failed to fetch/i,
    ],
  });
}

/** Attach authenticated user context (call after login). */
export function setSentryUser(userId: string | null, churchId?: string | null) {
  if (!userId) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: userId, churchId: churchId || undefined });
}

/** Clear user context (on signout). */
export function clearSentryUser() {
  Sentry.setUser(null);
}

export { Sentry };
