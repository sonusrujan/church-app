import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Response, NextFunction } from "express";
import type { AuthRequest } from "./requireAuth";

// We must mock config BEFORE the module loads
vi.mock("../config", () => ({
  SUPER_ADMIN_EMAILS: ["admin@shalom.com", "boss@church.org"],
  SUPER_ADMIN_PHONES: ["+919876543210"],
}));

import { isSuperAdminEmail, requireSuperAdmin } from "./requireSuperAdmin";

function createMockRes(): Response {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("isSuperAdminEmail", () => {
  it("returns true for a matching email (case-insensitive)", () => {
    expect(isSuperAdminEmail("ADMIN@SHALOM.COM")).toBe(true);
    expect(isSuperAdminEmail("admin@shalom.com")).toBe(true);
    expect(isSuperAdminEmail("Admin@Shalom.Com")).toBe(true);
  });

  it("returns false for a non-matching email", () => {
    expect(isSuperAdminEmail("nobody@shalom.com")).toBe(false);
  });

  it("returns true for a matching phone", () => {
    expect(isSuperAdminEmail(undefined, "+919876543210")).toBe(true);
  });

  it("returns false for a non-matching phone", () => {
    expect(isSuperAdminEmail(undefined, "+910000000000")).toBe(false);
  });

  it("returns false with undefined args", () => {
    expect(isSuperAdminEmail(undefined, undefined)).toBe(false);
  });

  it("returns true when email matches even if phone doesn't", () => {
    expect(isSuperAdminEmail("admin@shalom.com", "+910000000000")).toBe(true);
  });

  it("returns true when phone matches even if email doesn't", () => {
    expect(isSuperAdminEmail("nobody@test.com", "+919876543210")).toBe(true);
  });

  it("trims whitespace from email", () => {
    expect(isSuperAdminEmail("  admin@shalom.com  ")).toBe(true);
  });

  it("trims whitespace from phone", () => {
    expect(isSuperAdminEmail(undefined, " +919876543210 ")).toBe(true);
  });
});

describe("requireSuperAdmin middleware", () => {
  let next: NextFunction;
  beforeEach(() => {
    next = vi.fn();
  });

  it("returns 401 when req.user is missing", () => {
    const req = { user: undefined } as AuthRequest;
    const res = createMockRes();

    requireSuperAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Unauthenticated" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when user is not a super admin", () => {
    const req = {
      user: { id: "u1", email: "nobody@test.com", phone: "+910000", role: "admin", church_id: "c1" },
    } as AuthRequest;
    const res = createMockRes();

    requireSuperAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() for a super admin by email", () => {
    const req = {
      user: { id: "u1", email: "admin@shalom.com", phone: "", role: "superadmin", church_id: "c1" },
    } as AuthRequest;
    const res = createMockRes();

    requireSuperAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next() for a super admin by phone", () => {
    const req = {
      user: { id: "u1", email: "", phone: "+919876543210", role: "admin", church_id: "c1" },
    } as AuthRequest;
    const res = createMockRes();

    requireSuperAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
