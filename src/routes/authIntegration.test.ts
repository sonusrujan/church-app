import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";

// ── Mocks ──

vi.mock("../config", () => ({
  JWT_SECRET: "test-jwt-secret-key",
  APP_NAME: "TEST",
  FRONTEND_URL: "http://localhost:5173",
  TWILIO_ACCOUNT_SID: "test-sid",
  TWILIO_AUTH_TOKEN: "test-token",
  TWILIO_VERIFY_SERVICE_SID: "test-verify-sid",
  SUPER_ADMIN_PHONES: ["+919999999999"],
}));

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

const mockMaybeSingle = vi.fn();
const mockSingle = vi.fn();
vi.mock("../services/dbClient", () => ({
  db: (() => {
    // Chainable mock — every query-builder method returns `chain` so .eq().eq().order().limit() etc. all work
    const makeChain = () => {
      const chain: any = {};
      for (const m of ["select", "eq", "ilike", "is", "order", "limit", "in", "neq", "gte", "lte", "or"]) {
        chain[m] = vi.fn().mockReturnValue(chain);
      }
      chain.maybeSingle = mockMaybeSingle;
      chain.single = mockSingle;
      return chain;
    };
    return {
      from: vi.fn(() => {
        const chain = makeChain();
        chain.insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockSingle }) });
        chain.update = vi.fn().mockReturnValue(chain);
        chain.upsert = vi.fn().mockResolvedValue({ data: null, error: null });
        return chain;
      }),
    };
  })(),
  rawQuery: vi.fn().mockResolvedValue({ rows: [{ id: "user-1", email: "", phone_number: "+919876543210", role: "member", church_id: "church-1" }] }),
}));

vi.mock("../services/refreshTokenService", () => ({
  createRefreshToken: vi.fn().mockResolvedValue({ token: "mock-refresh-token", expiresAt: new Date(Date.now() + 86400000) }),
  rotateRefreshToken: vi.fn(),
  revokeRefreshToken: vi.fn(),
  revokeAllRefreshTokens: vi.fn(),
}));

vi.mock("../utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../middleware/requireAuth", () => ({
  requireAuth: vi.fn((_req: any, _res: any, next: () => void) => {
    _req.user = { id: "user-1", email: "test@test.com", phone: "+919876543210", role: "member", church_id: "church-1" };
    next();
  }),
  AuthRequest: {},
}));

vi.mock("../middleware/requireRegisteredUser", () => ({
  requireRegisteredUser: vi.fn((_req: any, _res: any, next: () => void) => {
    _req.registeredProfile = { id: "user-1", email: "test@test.com", role: "member", church_id: "church-1" };
    next();
  }),
}));

vi.mock("../middleware/requireSuperAdmin", () => ({
  isSuperAdminEmail: vi.fn(() => false),
}));

vi.mock("../utils/auditLog", () => ({
  persistAuditLog: vi.fn(),
}));

vi.mock("../services/userService", () => ({
  syncUserProfile: vi.fn().mockResolvedValue({ id: "user-1" }),
  updateCurrentUserProfile: vi.fn().mockResolvedValue({ id: "user-1" }),
  addFamilyMemberForCurrentUser: vi.fn().mockResolvedValue({ family_member: { id: "fm-1" } }),
  deleteFamilyMember: vi.fn().mockResolvedValue({ success: true }),
  updateFamilyMember: vi.fn().mockResolvedValue({ id: "fm-1" }),
  getMemberDashboardByEmail: vi.fn(),
  getRegisteredUserByPhone: vi.fn(),
  getRegisteredUserContext: vi.fn(),
  joinChurchByCode: vi.fn(),
}));

vi.mock("../services/churchSubscriptionService", () => ({
  getChurchSaaSSettings: vi.fn().mockResolvedValue({ member_subscription_enabled: true }),
}));

vi.mock("../services/familyRequestService", () => ({
  searchChurchMembers: vi.fn(),
  createFamilyMemberRequest: vi.fn(),
  listFamilyMemberRequests: vi.fn(),
  listMyFamilyMemberRequests: vi.fn(),
  reviewFamilyMemberRequest: vi.fn(),
}));

import otpRoutes from "./otpRoutes";
import authRoutes from "./authRoutes";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/otp", otpRoutes);
  app.use("/api/auth", authRoutes);
  return app;
}

function startServer(app: express.Application): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://localhost:${addr.port}`,
        close: () => server.close(),
      });
    });
  });
}

describe("Auth Integration Flow", () => {
  let serverInfo: { url: string; close: () => void };
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = buildApp();
    serverInfo = await startServer(app);
  });

  afterEach(() => {
    serverInfo?.close();
  });

  // ── OTP Flow ──

  it("OTP send → verify → JWT issued (full flow)", async () => {
    // Step 1: Send OTP
    mockVerificationsCreate.mockResolvedValue({ status: "pending" });
    const sendRes = await fetch(`${serverInfo.url}/api/otp/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210" }),
    });
    expect(sendRes.status).toBe(200);
    const sendBody = await sendRes.json();
    expect(sendBody.success).toBe(true);

    // Step 2: Verify OTP
    mockVerificationChecksCreate.mockResolvedValue({ status: "approved" });
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "user-1", email: "test@test.com", phone_number: "+919876543210", auth_user_id: "user-1" },
    });
    // member check
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: "member-1" } });
    // getUserProfileForJwt
    mockMaybeSingle.mockResolvedValueOnce({ data: { role: "member", church_id: "church-1" } });

    const verifyRes = await fetch(`${serverInfo.url}/api/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210", otp: "123456" }),
    });
    expect(verifyRes.status).toBe(200);
    const verifyBody = await verifyRes.json();
    expect(verifyBody.access_token).toBeDefined();
    expect(verifyBody.user.phone).toBe("+919876543210");

    // Verify JWT is valid
    const decoded = jwt.verify(verifyBody.access_token, "test-jwt-secret-key") as any;
    expect(decoded.sub).toBe("user-1");
    expect(decoded.church_id).toBe("church-1");
  });

  it("OTP send rejects empty phone", async () => {
    const res = await fetch(`${serverInfo.url}/api/otp/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("OTP verify rejects missing OTP", async () => {
    const res = await fetch(`${serverInfo.url}/api/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+919876543210" }),
    });
    expect(res.status).toBe(400);
  });

  // ── Auth Routes ──

  it("POST /api/auth/update-profile rejects invalid preferred_language", async () => {
    const res = await fetch(`${serverInfo.url}/api/auth/update-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer test-token" },
      body: JSON.stringify({ preferred_language: "invalid" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/auth/update-profile accepts valid data", async () => {
    const res = await fetch(`${serverInfo.url}/api/auth/update-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer test-token" },
      body: JSON.stringify({ full_name: "Test User", preferred_language: "hi" }),
    });
    expect(res.status).toBe(200);
  });

  it("POST /api/auth/family-members validates full_name required", async () => {
    const res = await fetch(`${serverInfo.url}/api/auth/family-members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer test-token" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("POST /api/auth/family-members accepts valid family member", async () => {
    const res = await fetch(`${serverInfo.url}/api/auth/family-members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer test-token" },
      body: JSON.stringify({ full_name: "Family Member", relation: "spouse", gender: "female" }),
    });
    expect(res.status).toBe(200);
  });

  it("POST /api/auth/join-church validates church_code required", async () => {
    const res = await fetch(`${serverInfo.url}/api/auth/join-church`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer test-token" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
