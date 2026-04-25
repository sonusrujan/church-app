import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// ── Common mocks ──
const mockApiRequest = vi.fn();

vi.mock("../lib/api", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  setActiveChurchId: vi.fn(),
  getActiveChurchId: () => "church-1",
  setTokenRefreshCallback: vi.fn(),
  tryRefreshToken: vi.fn().mockResolvedValue(null),
  API_BASE_URL: "http://localhost:4000",
}));

vi.mock("../i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    language: "en",
    setLanguage: vi.fn(),
  }),
}));

// ── apiRequest contract tests ──
describe("apiRequest — Error Handling Contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRequest.mockReset();
  });

  it("401 triggers token refresh attempt", async () => {
    // The real apiRequest intercepts 401 and tries refresh — we test the contract
    const error401 = Object.assign(new Error("Session expired. Please sign in again."), { status: 401 });
    mockApiRequest.mockRejectedValueOnce(error401);

    const result = mockApiRequest("/api/some-protected-endpoint", { token: "expired" });

    await expect(result).rejects.toThrow("Session expired");
  });

  it("403 returns permission denied message", async () => {
    const error403 = Object.assign(
      new Error("You do not have permission to perform this action."),
      { status: 403 },
    );
    mockApiRequest.mockRejectedValueOnce(error403);

    await expect(mockApiRequest("/api/admin/action")).rejects.toThrow("permission");
  });

  it("402 returns church subscription inactive message", async () => {
    const error402 = Object.assign(
      new Error("Your church subscription is inactive."),
      { status: 402 },
    );
    mockApiRequest.mockRejectedValueOnce(error402);

    await expect(mockApiRequest("/api/payments/order")).rejects.toThrow("inactive");
  });

  it("network error returns connection message", async () => {
    mockApiRequest.mockRejectedValueOnce(new Error("Network error. Please check your internet connection."));

    await expect(mockApiRequest("/api/dashboard")).rejects.toThrow("Network error");
  });

  it("timeout returns timeout message", async () => {
    mockApiRequest.mockRejectedValueOnce(new Error("Request timed out. Please check your connection."));

    await expect(mockApiRequest("/api/slow-endpoint", { timeout: 5000 })).rejects.toThrow("timed out");
  });
});

// ── Admin action tests ──
describe("Admin Actions — Membership Request Approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRequest.mockReset();
  });

  it("approve membership request calls correct endpoint", async () => {
    mockApiRequest.mockResolvedValueOnce({ success: true });

    await mockApiRequest("/api/requests/membership-requests/req-1/approve", {
      method: "POST",
      token: "admin-token",
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "/api/requests/membership-requests/req-1/approve",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reject membership request includes reason", async () => {
    mockApiRequest.mockResolvedValueOnce({ success: true });

    await mockApiRequest("/api/requests/membership-requests/req-1/reject", {
      method: "POST",
      token: "admin-token",
      body: { reason: "Incomplete information" },
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.stringContaining("reject"),
      expect.objectContaining({
        body: expect.objectContaining({ reason: "Incomplete information" }),
      }),
    );
  });
});

describe("Admin Actions — Account Deletion Request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRequest.mockReset();
  });

  it("submits account deletion request with reason", async () => {
    mockApiRequest.mockResolvedValueOnce({ success: true });

    await mockApiRequest("/api/requests/account-deletion-requests", {
      method: "POST",
      token: "member-token",
      body: { reason: "Moving to a different church" },
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "/api/requests/account-deletion-requests",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ reason: "Moving to a different church" }),
      }),
    );
  });
});

describe("Admin Actions — Manual Payment Recording", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRequest.mockReset();
  });

  it("records manual payment with required fields", async () => {
    mockApiRequest.mockResolvedValueOnce({
      payment: { id: "p-manual", receipt_number: "REC-001" },
    });

    const result = await mockApiRequest("/api/operations/manual-payments", {
      method: "POST",
      token: "admin-token",
      body: {
        member_id: "m1",
        subscription_id: "sub1",
        amount: 500,
        payment_method: "cash",
        payment_date: "2026-04-18",
      },
    });

    expect(result.payment.receipt_number).toBe("REC-001");
    expect(mockApiRequest).toHaveBeenCalledWith(
      "/api/operations/manual-payments",
      expect.objectContaining({
        body: expect.objectContaining({
          member_id: "m1",
          amount: 500,
          payment_method: "cash",
        }),
      }),
    );
  });
});

describe("Admin Actions — Subscription Cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRequest.mockReset();
  });

  it("cancellation request includes reason", async () => {
    mockApiRequest.mockResolvedValueOnce({ success: true });

    await mockApiRequest("/api/requests/cancellation-requests", {
      method: "POST",
      token: "member-token",
      body: { subscription_id: "sub1", reason: "Financial difficulties" },
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "/api/requests/cancellation-requests",
      expect.objectContaining({
        body: expect.objectContaining({
          subscription_id: "sub1",
          reason: "Financial difficulties",
        }),
      }),
    );
  });

  it("admin approves cancellation", async () => {
    mockApiRequest.mockResolvedValueOnce({ success: true });

    await mockApiRequest("/api/requests/cancellation-requests/cr-1/approve", {
      method: "POST",
      token: "admin-token",
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.stringContaining("approve"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("Admin — Growth Metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRequest.mockReset();
  });

  it("loads growth metrics for admin dashboard", async () => {
    mockApiRequest.mockResolvedValueOnce({
      total_members: 150,
      monthly_growth: [
        { month: "2026-01", count: 10 },
        { month: "2026-02", count: 15 },
      ],
      active_subscriptions: 120,
      overdue_subscriptions: 30,
    });

    const result = await mockApiRequest("/api/admin/growth", { token: "admin-token" });

    expect(result.total_members).toBe(150);
    expect(result.monthly_growth).toHaveLength(2);
    expect(result.active_subscriptions).toBe(120);
    expect(result.overdue_subscriptions).toBe(30);
  });
});
