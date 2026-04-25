import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../middleware/requireAuth";

// Mock dependencies
const mockSelect = vi.fn();
vi.mock("../services/dbClient", () => ({
  db: {
    from: () => ({ select: mockSelect }),
  },
}));

vi.mock("../utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("../middleware/requireSuperAdmin", () => ({
  isSuperAdminEmail: (email?: string) => email === "superadmin@test.com",
}));

import { requireRegisteredUser } from "./requireRegisteredUser";

function createMockRes(): Response {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("requireRegisteredUser middleware", () => {
  let next: NextFunction;
  beforeEach(() => {
    next = vi.fn();
    vi.clearAllMocks();
  });

  it("returns 401 when req.user is missing", async () => {
    const req = {} as AuthRequest;
    const res = createMockRes();

    await requireRegisteredUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
