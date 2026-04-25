import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pool with connect method
const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn();

vi.mock("./services/dbClient", () => ({
  pool: {
    connect: () => mockConnect(),
    totalCount: 5,
    idleCount: 3,
    waitingCount: 0,
  },
  db: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
  },
}));

const mockLogger: any = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn(), level: "info" };
mockLogger.child = vi.fn(() => mockLogger);
vi.mock("./utils/logger", () => ({
  logger: mockLogger,
}));

vi.mock("pino-http", () => ({
  default: () => (_req: any, _res: any, next: () => void) => next(),
}));

// Mock all route modules to prevent them from loading DB connections at import time
vi.mock("./routes/memberRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/subscriptionRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/paymentRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/announcementRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/adminRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/authRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/churchRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/pastorRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/engagementRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/requestRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/adminExtrasRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/operationsRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/otpRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/leadershipRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/webhookRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/saasRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/googleAuthRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/uploadRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/dioceseRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/adBannerRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/specialDateRoutes", () => ({ default: vi.fn() }));
vi.mock("./routes/pushRoutes", () => ({ default: vi.fn() }));
vi.mock("./middleware/rlsContext", () => ({
  rlsStorage: {
    run: vi.fn((_store: any, cb: () => void) => cb()),
    getStore: () => ({ churchId: null }),
  },
}));
vi.mock("./middleware/inputSanitizer", () => ({
  sanitizeHtml: vi.fn((_req: any, _res: any, next: () => void) => next()),
}));
vi.mock("./middleware/requireActiveChurch", () => ({
  requireActiveChurch: vi.fn((_req: any, _res: any, next: () => void) => next()),
}));
vi.mock("./config", () => ({
  APP_NAME: "TEST",
  FRONTEND_URL: "http://localhost:5173",
  SUPER_ADMIN_EMAILS: [],
  SUPER_ADMIN_PHONES: [],
  JWT_SECRET: "test-secret-key-for-testing-only",
  RAZORPAY_KEY_ID: "",
  DATABASE_URL: "",
  PAYMENTS_ENABLED: false,
  TWILIO_ACCOUNT_SID: "",
  TWILIO_AUTH_TOKEN: "",
  TWILIO_VERIFY_SERVICE_SID: "",
  TWILIO_MESSAGING_SERVICE_SID: "",
  PRIMARY_SUPER_ADMIN_EMAIL: "",
  PRIMARY_SUPER_ADMIN_PHONE: "",
  VAPID_PUBLIC_KEY: "",
  VAPID_PRIVATE_KEY: "",
  VAPID_SUBJECT: "",
}));

describe("Health check endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with pool stats when DB is healthy", async () => {
    mockConnect.mockResolvedValue({
      query: mockQuery.mockResolvedValue(undefined),
      release: mockRelease,
    });

    // Dynamic import to get the app after mocks are set
    const { default: app } = await import("./app");
    // Use a lightweight supertest-like approach
    const http = await import("http");
    const server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, async () => {
        const addr = server.address() as { port: number };
        try {
          const resp = await fetch(`http://localhost:${addr.port}/health`);
          const body = await resp.json();
          expect(resp.status).toBe(200);
          expect(body.status).toBe("ok");
          expect(body.db).toBe("connected");
          expect(body.pool).toEqual({ total: 5, idle: 3, waiting: 0 });
        } finally {
          server.close();
          resolve();
        }
      });
    });
  });

  it("returns 503 when DB connection fails", async () => {
    mockConnect.mockRejectedValue(new Error("Connection refused"));

    const { default: app } = await import("./app");
    const http = await import("http");
    const server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, async () => {
        const addr = server.address() as { port: number };
        try {
          const resp = await fetch(`http://localhost:${addr.port}/health`);
          const body = await resp.json();
          expect(resp.status).toBe(503);
          expect(body.status).toBe("unhealthy");
        } finally {
          server.close();
          resolve();
        }
      });
    });
  });
});
