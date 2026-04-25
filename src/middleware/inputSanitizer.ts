import { Request, Response, NextFunction } from "express";
import xss from "xss";

/**
 * Recursively sanitizes all string values in an object using the xss library.
 * This is a defense-in-depth measure against stored XSS.
 */
const MAX_STRING_LENGTH = 5000;

// Strip all HTML — no tags allowed
const xssOptions = {
  whiteList: {} as Record<string, string[]>,
  stripIgnoreTag: true,
  stripIgnoreTagBody: ["script", "style"],
};

/** Fields that should be validated as URLs (only http/https allowed) */
const URL_FIELD_NAMES = new Set(["image_url", "avatar_url", "logo_url", "url", "photo_url"]);

function isSafeUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function stripTags(value: unknown, fieldName?: string): unknown {
  if (typeof value === "string") {
    const cleaned = xss(value, xssOptions);
    const trimmed = cleaned.length > MAX_STRING_LENGTH ? cleaned.slice(0, MAX_STRING_LENGTH) : cleaned;
    // Validate URL fields — reject javascript:, data:, etc.
    if (fieldName && URL_FIELD_NAMES.has(fieldName) && trimmed && !isSafeUrl(trimmed)) {
      return "";
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    return value.map((v) => stripTags(v));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = stripTags(v, k);
    }
    return result;
  }
  return value;
}

/**
 * Express middleware that sanitizes req.body and req.query by stripping HTML tags
 * from all string fields. Prevents stored XSS.
 */
export function sanitizeHtml(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === "object") {
    req.body = stripTags(req.body);
  }
  if (req.query && typeof req.query === "object") {
    for (const key of Object.keys(req.query)) {
      if (typeof req.query[key] === "string") {
        req.query[key] = stripTags(req.query[key]) as string;
      }
    }
  }
  // MED-009: Sanitize route params to prevent XSS in logs/error responses
  if (req.params && typeof req.params === "object") {
    for (const key of Object.keys(req.params)) {
      if (typeof req.params[key] === "string") {
        req.params[key] = stripTags(req.params[key]) as string;
      }
    }
  }
  next();
}
