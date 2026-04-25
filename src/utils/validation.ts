/** Shared UUID v4 regex pattern (case-insensitive). */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Test whether a string is a valid UUID v4. */
export function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}
