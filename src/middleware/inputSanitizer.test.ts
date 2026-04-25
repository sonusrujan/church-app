import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

import { sanitizeHtml } from "./inputSanitizer";

function createMockReq(body?: any, query?: any): Request {
  return {
    body,
    query: query || {},
  } as unknown as Request;
}

function createMockRes(): Response {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("sanitizeHtml middleware", () => {
  let next: NextFunction;
  beforeEach(() => {
    next = vi.fn();
  });

  it("calls next() on request with no body", () => {
    const req = createMockReq(undefined);
    const res = createMockRes();

    sanitizeHtml(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("strips <script> tags from body strings", () => {
    const req = createMockReq({
      name: '<script>alert("xss")</script>Hello',
    });
    const res = createMockRes();

    sanitizeHtml(req, res, next);

    expect(req.body.name).not.toContain("<script>");
    expect(req.body.name).toContain("Hello");
    expect(next).toHaveBeenCalled();
  });

  it("strips <img onerror> XSS payloads", () => {
    const req = createMockReq({
      bio: '<img src=x onerror=alert(1)>Safe text',
    });
    const res = createMockRes();

    sanitizeHtml(req, res, next);

    expect(req.body.bio).not.toContain("onerror");
    expect(req.body.bio).toContain("Safe text");
  });

  it("strips HTML from nested objects", () => {
    const req = createMockReq({
      outer: {
        inner: "<b>bold</b> text",
      },
    });
    const res = createMockRes();

    sanitizeHtml(req, res, next);

    expect(req.body.outer.inner).not.toContain("<b>");
    expect(req.body.outer.inner).toContain("bold");
    expect(req.body.outer.inner).toContain("text");
  });

  it("strips HTML from arrays", () => {
    const req = createMockReq({
      tags: ["<em>one</em>", "<strong>two</strong>"],
    });
    const res = createMockRes();

    sanitizeHtml(req, res, next);

    expect(req.body.tags[0]).not.toContain("<em>");
    expect(req.body.tags[1]).not.toContain("<strong>");
  });

  it("truncates strings exceeding MAX_STRING_LENGTH (5000)", () => {
    const longStr = "A".repeat(6000);
    const req = createMockReq({ text: longStr });
    const res = createMockRes();

    sanitizeHtml(req, res, next);

    expect(req.body.text.length).toBeLessThanOrEqual(5000);
  });

  it("preserves non-string values (numbers, booleans, null)", () => {
    const req = createMockReq({
      count: 42,
      active: true,
      deleted: null,
    });
    const res = createMockRes();

    sanitizeHtml(req, res, next);

    expect(req.body.count).toBe(42);
    expect(req.body.active).toBe(true);
    expect(req.body.deleted).toBe(null);
  });

  it("strips HTML from query parameters", () => {
    const req = createMockReq({}, { search: '<script>bad</script>safe' });
    const res = createMockRes();

    sanitizeHtml(req, res, next);

    expect(req.query.search).not.toContain("<script>");
    expect(req.query.search).toContain("safe");
  });

  it("strips <style> tags from body", () => {
    const req = createMockReq({
      content: '<style>body{display:none}</style>Visible',
    });
    const res = createMockRes();

    sanitizeHtml(req, res, next);

    expect(req.body.content).not.toContain("<style>");
    expect(req.body.content).toContain("Visible");
  });

  it("handles deeply nested structure", () => {
    const req = createMockReq({
      a: { b: { c: { d: "<div>deep</div>" } } },
    });
    const res = createMockRes();

    sanitizeHtml(req, res, next);

    expect(req.body.a.b.c.d).toBe("deep");
  });
});
