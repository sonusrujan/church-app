import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthRequest } from "../middleware/requireAuth";

// Mock dependencies
const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock("../services/dbClient", () => ({
  db: {
    from: () => ({
      insert: mockInsert,
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    }),
  },
}));

vi.mock("./logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { persistAuditLog } from "./auditLog";

describe("persistAuditLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts IP from x-forwarded-for header", async () => {
    const req = {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
      socket: { remoteAddress: "127.0.0.1" },
      user: { id: "u1", email: "test@test.com", role: "admin", church_id: "c1" },
      method: "POST",
      originalUrl: "/api/members",
    } as unknown as AuthRequest;

    await persistAuditLog(req, "create_member", "member", "m1");

    expect(mockInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        ip_address: "1.2.3.4",
        action: "create_member",
        entity_type: "member",
        entity_id: "m1",
      }),
    ]);
  });

  it("falls back to socket remoteAddress when no forwarded header", async () => {
    const req = {
      headers: {},
      socket: { remoteAddress: "192.168.1.1" },
      user: { id: "u1", email: "test@test.com", role: "admin", church_id: "c1" },
      method: "GET",
      originalUrl: "/api/members",
    } as unknown as AuthRequest;

    await persistAuditLog(req, "list_members");

    expect(mockInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        ip_address: "192.168.1.1",
        actor_user_id: "u1",
        actor_email: "test@test.com",
      }),
    ]);
  });

  it("includes method and path in details", async () => {
    const req = {
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      user: { id: "u1", email: "test@test.com", role: "admin", church_id: "c1" },
      method: "DELETE",
      originalUrl: "/api/members/m1",
    } as unknown as AuthRequest;

    await persistAuditLog(req, "delete_member", "member", "m1", { reason: "duplicate" });

    expect(mockInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        details: expect.objectContaining({
          method: "DELETE",
          path: "/api/members/m1",
          reason: "duplicate",
        }),
      }),
    ]);
  });

  it("handles missing user gracefully", async () => {
    const req = {
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      user: undefined,
      method: "GET",
      originalUrl: "/api/test",
    } as unknown as AuthRequest;

    await persistAuditLog(req, "anonymous_action");

    expect(mockInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        actor_user_id: null,
        actor_email: "unknown",
        actor_role: null,
        church_id: null,
      }),
    ]);
  });

  it("does not throw when DB insert fails (non-blocking)", async () => {
    mockInsert.mockRejectedValueOnce(new Error("DB error"));

    const req = {
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      user: { id: "u1", email: "a@b.com", role: "admin", church_id: "c1" },
      method: "POST",
      originalUrl: "/api/test",
    } as unknown as AuthRequest;

    // Should not throw
    await expect(persistAuditLog(req, "test_action")).resolves.toBeUndefined();
  });
});
