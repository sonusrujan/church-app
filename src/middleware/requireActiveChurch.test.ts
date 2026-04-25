import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Response, NextFunction } from "express";
import type { AuthRequest } from "./requireAuth";

// Mock dependencies
const mockMaybeSingle = vi.fn();
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
vi.mock("../services/dbClient", () => ({
  db: {
    from: () => ({ select: mockSelect }),
  },
}));

vi.mock("../utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("./requireSuperAdmin", () => ({
  isSuperAdminEmail: (email?: string) => email === "superadmin@test.com",
}));

import { requireActiveChurch } from "./requireActiveChurch";

function createMockRes(): Response {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("requireActiveChurch middleware", () => {
  let next: NextFunction;
  beforeEach(() => {
    next = vi.fn();
    vi.clearAllMocks();
  });

  it("calls next() when user has no church_id", async () => {
    const req = {
      user: { id: "u1", email: "test@test.com", phone: "", role: "member", church_id: "" },
    } as AuthRequest;
    const res = createMockRes();

    await requireActiveChurch(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("calls next() for super admin regardless of church status", async () => {
    const req = {
      user: { id: "u1", email: "superadmin@test.com", phone: "", role: "superadmin", church_id: "c1" },
    } as AuthRequest;
    const res = createMockRes();

    await requireActiveChurch(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("returns 403 when church is not found", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null });
    const req = {
      user: { id: "u1", email: "test@test.com", phone: "", role: "admin", church_id: "nonexistent" },
    } as AuthRequest;
    const res = createMockRes();

    await requireActiveChurch(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Church not found" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when church is deleted", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: "c1", service_enabled: true, trial_ends_at: null, deleted_at: "2024-01-01" },
    });
    const req = {
      user: { id: "u1", email: "test@test.com", phone: "", role: "admin", church_id: "c1" },
    } as AuthRequest;
    const res = createMockRes();

    await requireActiveChurch(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("deactivated") }));
  });

  it("returns 402 when church service is disabled", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: "c1", service_enabled: false, trial_ends_at: null, deleted_at: null },
    });
    const req = {
      user: { id: "u1", email: "test@test.com", phone: "", role: "admin", church_id: "c1" },
    } as AuthRequest;
    const res = createMockRes();

    await requireActiveChurch(req, res, next);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "CHURCH_INACTIVE" }));
  });
});
