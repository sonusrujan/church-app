/**
 * Returns a safe error message for API responses.
 * Only messages matching known safe business-logic prefixes are forwarded.
 * All other errors (DB, network, runtime) are replaced with the generic fallback.
 */

const SAFE_MESSAGE_PATTERNS = [
  /^(amount|donation|payment|subscription|member|church|family|otp|phone|email|name|address|gender|date|event|prayer|notification|banner|plan|category|receipt|refund|role|token|request|access|file|image|upload)/i,
  /must be/i,
  /already exists/i,
  /not found/i,
  /not allowed/i,
  /not permitted/i,
  /not configured/i,
  /not enabled/i,
  /is required/i,
  /is invalid/i,
  /cannot be/i,
  /does not belong/i,
  /does not match/i,
  /exceeds the maximum/i,
  /too many/i,
  /no subscriptions/i,
  /no active/i,
  /disabled/i,
  /unauthorized/i,
  /unauthenticated/i,
  /forbidden/i,
  /expired/i,
  /failed to (send|create|update|delete|verify|upload|process)/i,
];

const INTERNAL_ERROR_PATTERNS = [
  /column .* does not exist/i,
  /relation .* does not exist/i,
  /duplicate key value/i,
  /violates .* constraint/i,
  /syntax error/i,
  /permission denied/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /timeout exceeded/i,
  /socket hang up/i,
  /network error/i,
  /unexpected token/i,
  /cannot read propert/i,
  /is not a function/i,
  /undefined is not/i,
];

export function safeErrorMessage(err: unknown, fallback: string): string {
  if (!err) return fallback;

  const message =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message?: unknown }).message || "")
      : typeof err === "string"
        ? err
        : "";

  if (!message) return fallback;

  // Block known internal error patterns first
  for (const pattern of INTERNAL_ERROR_PATTERNS) {
    if (pattern.test(message)) return fallback;
  }

  // Only allow messages matching known safe business-logic patterns
  for (const pattern of SAFE_MESSAGE_PATTERNS) {
    if (pattern.test(message)) return message;
  }

  return fallback;
}
