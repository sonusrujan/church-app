/**
 * Returns a safe error message for API responses.
 * Business-logic errors (thrown with `new Error(...)` in our code) are safe.
 * External/database errors may contain internal details (table names, column names)
 * and must be replaced with the generic fallback.
 */

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

  for (const pattern of INTERNAL_ERROR_PATTERNS) {
    if (pattern.test(message)) return fallback;
  }

  return message;
}
