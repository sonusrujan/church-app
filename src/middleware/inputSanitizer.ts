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

function stripTags(value: unknown): unknown {
  if (typeof value === "string") {
    const cleaned = xss(value, xssOptions);
    return cleaned.length > MAX_STRING_LENGTH ? cleaned.slice(0, MAX_STRING_LENGTH) : cleaned;
  }
  if (Array.isArray(value)) {
    return value.map(stripTags);
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = stripTags(v);
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
  next();
}
