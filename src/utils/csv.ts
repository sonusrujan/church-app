/**
 * CSV cell sanitisation: defends against formula injection in
 * Excel/Google Sheets/Numbers and strips control characters that
 * can break naive parsers or smuggle payloads into downstream tools.
 */
export function escapeCsvField(value: unknown): string {
  if (value == null) return "";
  let safe = String(value);

  // Strip BOM + invisible boundary chars some spreadsheets honour.
  safe = safe.replace(/^[\uFEFF\u200B\u200C\u200D\u2060]+/, "");

  // Strip C0/C1 control chars except TAB(09), LF(0A), CR(0D).
  safe = safe.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Formula prefix neutralisation — leading whitespace before the trigger
  // is also covered because spreadsheets trim before evaluation.
  if (
    /^\s*[=+\-@\t\r]/.test(safe) ||
    /^\s*(?:DDE|cmd|HYPERLINK)\b/i.test(safe)
  ) {
    safe = "'" + safe;
  }

  if (
    safe.includes(",") ||
    safe.includes('"') ||
    safe.includes("\n") ||
    safe.includes("\r") ||
    safe.includes("\t")
  ) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function toCsvRow(fields: unknown[]): string {
  return fields.map(escapeCsvField).join(",");
}
