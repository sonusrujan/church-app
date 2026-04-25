import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock config
vi.mock("../config", () => ({
  JWT_SECRET: "test-jwt-secret-key",
  APP_NAME: "TEST",
  FRONTEND_URL: "http://localhost:5173",
  TWILIO_ACCOUNT_SID: "test-sid",
  TWILIO_AUTH_TOKEN: "test-token",
  TWILIO_VERIFY_SERVICE_SID: "test-verify-sid",
  SUPER_ADMIN_PHONES: ["+919999999999"],
}));

// Mock Twilio
const mockVerificationsCreate = vi.fn();
const mockVerificationChecksCreate = vi.fn();
vi.mock("twilio", () => ({
  default: () => ({
    verify: {
      v2: {
        services: () => ({
          verifications: { create: mockVerificationsCreate },
          verificationChecks: { create: mockVerificationChecksCreate },
        }),
      },
    },
  }),
}));

// Mock DB
const mockMaybeSingle = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
vi.mock("../services/dbClient", () => ({
  db: {
    from: () => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: mockMaybeSingle,
          limit: vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle }),
        }),
        ilike: vi.fn().mockReturnValue({
          maybeSingle: mockMaybeSingle,
        }),
      }),
      insert: mockInsert,
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ data: null, error: null }),
      }),
    }),
  },
}));

vi.mock("../services/refreshTokenService", () => ({
  createRefreshToken: vi.fn().mockResolvedValue("mock-refresh-token"),
}));

vi.mock("../utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../middleware/requireAuth", () => ({
  requireAuth: vi.fn((_req: any, _res: any, next: () => void) => next()),
  AuthRequest: {},
}));

import otpRoutes from "./otpRoutes";
import express from "express";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/otp", otpRoutes);
  return app;
}

describe("OTP Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/otp/send", () => {
    it("rejects request without phone number", async () => {
      const app = buildApp();
      const res = await fetch(await startServer(app, "/api/otp/send"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("rejects invalid phone number format", async () => {
      const app = buildApp();
      const res = await fetch(await startServer(app, "/api/otp/send"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "abc" }),
      });
      expect(res.status).toBe(400);
    });

    it("sends OTP for valid phone number", async () => {
      mockVerificationsCreate.mockResolvedValue({ status: "pending" });
      const app = buildApp();
      const res = await fetch(await startServer(app, "/api/otp/send"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "+919876543210" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });
});

// Helper to start server on random port and return URL
async function startServer(app: express.Application, path: string): Promise<string> {
  const http = await import("http");
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      // Auto-close after a short delay
      setTimeout(() => server.close(), 2000);
      resolve(`http://localhost:${addr.port}${path}`);
    });
  });
}
