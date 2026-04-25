/**
 * Shared Indian phone normalization utility.
 * Converts any phone input into +91XXXXXXXXXX format.
 */

/** Normalize any phone input into +91XXXXXXXXXX format */
export function normalizeIndianPhone(raw: string): string {
  let d = raw.replace(/[\s\-()]/g, "");
  if (d.startsWith("+91")) d = d.slice(3);
  else if (d.startsWith("91") && d.length > 10) d = d.slice(2);
  d = d.replace(/\D/g, "");
  return d ? `+91${d}` : "";
}

/** Validate that a normalized phone is a valid Indian mobile */
export function isValidIndianPhone(normalized: string): boolean {
  return /^\+91[6-9]\d{9}$/.test(normalized);
}
