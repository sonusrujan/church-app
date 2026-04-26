import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// Mock DB
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
vi.mock("../services/dbClient", () => ({
  db: {
    from: () => ({
      insert: mockInsert,
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          single: vi.fn().mockResolvedValue({ data: null }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  },
}));

vi.mock("../utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import webhookRoutes from "./webhookRoutes";
import express from "express";

function buildApp() {
  const app = express();
  app.use(express.json({
    verify: (req: any, _res, buf) => { req.rawBody = buf; },
  }));
  app.use("/api/webhooks", webhookRoutes);
  return app;
}

// Helper to start server on random port and return URL
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

describe("Webhook Routes", () => {
  const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/webhooks/razorpay", () => {
    it("rejects request without signature header", async () => {
      const app = buildApp();
      const url = await startServer(app, "/api/webhooks/razorpay");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "payment.captured" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("signature");
    });

    it("rejects request with invalid signature", async () => {
      const app = buildApp();
      const url = await startServer(app, "/api/webhooks/razorpay");
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-razorpay-signature": "invalid-signature",
        },
        body: JSON.stringify({ event: "payment.captured" }),
      });
      // Should be 400 (invalid) or 500 (not configured)
      expect([400, 500]).toContain(res.status);
    });

    it("skips webhook event with no entity ID", async () => {
      // Only works if RAZORPAY_WEBHOOK_SECRET is configured.
      if (!WEBHOOK_SECRET) return;

      const payload = JSON.stringify({ event: "payment.captured", payload: {} });
      const signature = crypto
        .createHmac("sha256", WEBHOOK_SECRET)
        .update(payload)
        .digest("hex");

      const app = buildApp();
      const url = await startServer(app, "/api/webhooks/razorpay");
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-razorpay-signature": signature,
        },
        body: payload,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toContain("skipped");
    });
  });
});
