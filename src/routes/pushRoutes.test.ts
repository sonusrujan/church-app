import { describe, it, expect, vi, beforeEach } from "vitest";

import jwt from "jsonwebtoken";

// Mock config
vi.mock("../config", () => ({
  JWT_SECRET: "test-jwt-secret-key",
  VAPID_PUBLIC_KEY: "test-vapid-public-key",
  VAPID_PRIVATE_KEY: "",
  VAPID_SUBJECT: "",
}));

const TEST_JWT = jwt.sign({ sub: "user-456" }, "test-jwt-secret-key", { expiresIn: "5m" });

// Mock DB
const mockMaybeSingle = vi.fn();
vi.mock("../services/dbClient", () => ({
  db: {
    from: () => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: mockMaybeSingle,
        }),
      }),
    }),
  },
}));

// Mock notification service
const mockSavePushSubscription = vi.fn().mockResolvedValue(undefined);
const mockRemovePushSubscription = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/notificationService", () => ({
  savePushSubscription: (...args: any[]) => mockSavePushSubscription(...args),
  removePushSubscription: (...args: any[]) => mockRemovePushSubscription(...args),
  queueNotification: vi.fn(),
  sendSmsNow: vi.fn(),
}));

vi.mock("../utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../utils/safeError", () => ({
  safeErrorMessage: (_err: any, fallback: string) => fallback,
}));

vi.mock("../utils/auditLog", () => ({
  persistAuditLog: vi.fn(),
}));

vi.mock("../services/jobQueueService", () => ({
  enqueueJob: vi.fn(),
}));

vi.mock("../middleware/requireAuth", () => ({
  requireAuth: vi.fn((req: any, _res: any, next: () => void) => {
    req.user = { id: "user-123", email: "test@test.com", phone: "+919876543210", role: "member", church_id: "church-1" };
    next();
  }),
  AuthRequest: {},
}));

vi.mock("../middleware/requireRegisteredUser", () => ({
  requireRegisteredUser: vi.fn((_req: any, _res: any, next: () => void) => next()),
}));

vi.mock("../middleware/requireSuperAdmin", () => ({
  requireSuperAdmin: vi.fn((_req: any, _res: any, next: () => void) => next()),
  isSuperAdminEmail: vi.fn(() => true),
}));

import pushRoutes from "./pushRoutes";
import express from "express";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/push", pushRoutes);
  return app;
}

async function startServer(app: express.Application, path: string): Promise<string> {
  const http = await import("http");
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      setTimeout(() => server.close(), 2000);
      resolve(`http://localhost:${addr.port}${path}`);
    });
  });
}

describe("Push Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/push/vapid-public-key", () => {
    it("returns VAPID public key", async () => {
      const app = buildApp();
      const url = await startServer(app, "/api/push/vapid-public-key");
      const res = await fetch(url);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.publicKey).toBe("test-vapid-public-key");
    });
  });

  describe("POST /api/push/subscribe", () => {
    it("saves push subscription for authenticated user", async () => {
      const app = buildApp();
      const url = await startServer(app, "/api/push/subscribe");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer mock" },
        body: JSON.stringify({
          endpoint: "https://fcm.googleapis.com/test",
          keys: { p256dh: "test-key", auth: "test-auth" },
        }),
      });
      expect(res.status).toBe(200);
      expect(mockSavePushSubscription).toHaveBeenCalledWith(
        "user-123",
        "https://fcm.googleapis.com/test",
        "test-key",
        "test-auth"
      );
    });

    it("rejects subscription without valid keys", async () => {
      const app = buildApp();
      const url = await startServer(app, "/api/push/subscribe");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer mock" },
        body: JSON.stringify({ endpoint: "https://test.com" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/push/resubscribe", () => {
    it("rotates push subscription when old endpoint is found", async () => {
      mockMaybeSingle.mockResolvedValue({ data: { user_id: "user-456" } });
      const app = buildApp();
      const url = await startServer(app, "/api/push/resubscribe");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TEST_JWT}` },
        body: JSON.stringify({
          oldEndpoint: "https://old.endpoint.com",
          newEndpoint: "https://new.endpoint.com",
          keys: { p256dh: "new-key", auth: "new-auth" },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(mockRemovePushSubscription).toHaveBeenCalledWith("user-456", "https://old.endpoint.com");
      expect(mockSavePushSubscription).toHaveBeenCalledWith("user-456", "https://new.endpoint.com", "new-key", "new-auth");
    });

    it("rejects resubscribe without valid keys", async () => {
      const app = buildApp();
      const url = await startServer(app, "/api/push/resubscribe");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEndpoint: "https://new.com" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 401 when no auth token provided", async () => {
      mockMaybeSingle.mockResolvedValue({ data: null });
      const app = buildApp();
      const url = await startServer(app, "/api/push/resubscribe");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldEndpoint: "https://unknown.endpoint.com",
          newEndpoint: "https://new.endpoint.com",
          keys: { p256dh: "key", auth: "auth" },
        }),
      });
      expect(res.status).toBe(401);
    });
  });
});
