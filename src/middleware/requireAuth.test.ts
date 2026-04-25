import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import type { Response, NextFunction } from "express";
import type { AuthRequest } from "./requireAuth";

// Mock config before importing requireAuth
vi.mock("../config", () => ({
  JWT_SECRET: "test-jwt-secret-key",
}));

// Mock dbClient
const mockRawQuery = vi.fn();
vi.mock("../services/dbClient", () => ({
  db: {
    from: () => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn() })) })) }),
  },
  rawQuery: (...args: any[]) => mockRawQuery(...args),
}));

// Mock rlsContext
vi.mock("./rlsContext", () => ({
  rlsStorage: { getStore: () => ({}), run: vi.fn() },
  setCurrentChurchId: vi.fn(),
}));

vi.mock("../utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { requireAuth } from "./requireAuth";

function createMockReq(authHeader?: string): AuthRequest {
  return {
    headers: { authorization: authHeader },
    ip: "127.0.0.1",
    path: "/test",
  } as unknown as AuthRequest;
}

function createMockRes(): Response {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("requireAuth middleware", () => {
  let next: NextFunction;
  beforeEach(() => {
    next = vi.fn();
    vi.clearAllMocks();
  });

  it("rejects request with no authorization header", async () => {
    const req = createMockReq(undefined);
    const res = createMockRes();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("Missing") }));
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects request with empty Bearer token", async () => {
    const req = createMockReq("Bearer ");
    const res = createMockRes();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects request with non-Bearer auth scheme", async () => {
    const req = createMockReq("Basic abc123");
    const res = createMockRes();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects token with wrong format (not 3 parts)", async () => {
    const req = createMockReq("Bearer not-a-valid-jwt");
    const res = createMockRes();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("format") }));
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects expired JWT token", async () => {
    const token = jwt.sign({ sub: "user-123" }, "test-jwt-secret-key", { expiresIn: "-1s" });
    const req = createMockReq(`Bearer ${token}`);
    const res = createMockRes();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects JWT signed with wrong secret", async () => {
    const token = jwt.sign({ sub: "user-123" }, "wrong-secret", { expiresIn: "1h" });
    const req = createMockReq(`Bearer ${token}`);
    const res = createMockRes();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects JWT with no sub claim", async () => {
    const token = jwt.sign({ email: "test@test.com" }, "test-jwt-secret-key", { expiresIn: "1h" });
    const req = createMockReq(`Bearer ${token}`);
    const res = createMockRes();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects when user not found in DB", async () => {
    mockRawQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const token = jwt.sign({ sub: "user-123" }, "test-jwt-secret-key", { expiresIn: "1h" });
    const req = createMockReq(`Bearer ${token}`);
    const res = createMockRes();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("not found") }));
    expect(next).not.toHaveBeenCalled();
  });
});
