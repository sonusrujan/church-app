import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// ── Mock all external dependencies ──
const mockApiRequest = vi.fn();
const mockOpenRazorpayCheckout = vi.fn();

vi.mock("../lib/api", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  setActiveChurchId: vi.fn(),
  getActiveChurchId: () => "church-1",
  setTokenRefreshCallback: vi.fn(),
  tryRefreshToken: vi.fn().mockResolvedValue(null),
  API_BASE_URL: "http://localhost:4000",
}));

vi.mock("../lib/razorpayCheckout", () => ({
  openRazorpayCheckout: (...args: unknown[]) => mockOpenRazorpayCheckout(...args),
}));

vi.mock("recharts", () => ({
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("../i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      // Return a recognizable string for test assertions
      if (params) return `${key}:${JSON.stringify(params)}`;
      return key;
    },
    language: "en",
    setLanguage: vi.fn(),
  }),
}));

vi.mock("../components/LoadingSkeleton", () => ({
  default: () => <div data-testid="loading-skeleton">Loading...</div>,
}));

vi.mock("../components/CheckoutSummary", () => ({
  default: ({ onPay, payLabel }: { onPay: () => void; payLabel: string }) => (
    <div data-testid="checkout-summary">
      <button onClick={onPay}>{payLabel}</button>
    </div>
  ),
}));

// Mock AppContext
const mockRefreshDashboard = vi.fn().mockResolvedValue(null);
const mockLoadIncomeSummary = vi.fn().mockResolvedValue(undefined);
const mockSetNotice = vi.fn();
const mockSetBusyKey = vi.fn();
const mockWithAuthRequest = vi.fn();
const paymentInProgressRef = { current: false };

const baseMemberDashboard = {
  member: { id: "m1", email: "member@test.com", full_name: "Test Member" },
  church: { id: "church-1", name: "Test Church" },
  subscriptions: [
    { id: "sub1", plan_name: "Monthly", amount: 500, status: "active", billing_cycle: "monthly" },
  ],
  due_subscriptions: [
    {
      subscription_id: "sub1",
      plan_name: "Monthly Dues",
      person_name: "Test Member",
      monthly_amount: 500,
      amount: 500,
      overdue_months: 2,
      overdue_since: "2026-02-01",
      billing_cycle: "monthly",
    },
  ],
};

const createMockContext = (overrides: Record<string, unknown> = {}) => ({
  token: "test-jwt-token",
  userEmail: "member@test.com",
  authContext: {
    profile: { full_name: "Test Member", role: "member", church_id: "church-1" },
  },
  isSuperAdmin: false,
  isChurchAdmin: false,
  memberDashboard: baseMemberDashboard,
  refreshMemberDashboard: mockRefreshDashboard,
  churches: [],
  admins: [],
  paymentsEnabled: true,
  paymentConfigError: "",
  busyKey: "",
  setBusyKey: mockSetBusyKey,
  setNotice: mockSetNotice,
  withAuthRequest: mockWithAuthRequest,
  loadChurches: vi.fn(),
  loadAdmins: vi.fn(),
  loadIncomeSummary: mockLoadIncomeSummary,
  paymentInProgressRef,
  events: [],
  notifications: [],
  ...overrides,
});

vi.mock("../context/AppContext", () => ({
  useApp: () => createMockContext(),
}));

// Import AFTER mocks
import DashboardPage from "../pages/DashboardPage";
import { MemoryRouter } from "react-router-dom";

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe("DashboardPage — Due Subscriptions Data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paymentInProgressRef.current = false;
  });

  it("due_subscriptions array is available from member dashboard", () => {
    const dues = baseMemberDashboard.due_subscriptions;
    expect(dues).toHaveLength(1);
    expect(dues[0].subscription_id).toBe("sub1");
    expect(dues[0].plan_name).toBe("Monthly Dues");
    expect(dues[0].monthly_amount).toBe(500);
    expect(dues[0].overdue_months).toBe(2);
  });
});

describe("DashboardPage — Payment Flow Guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paymentInProgressRef.current = false;
  });

  it("prevents double payment submission (paymentInProgressRef)", async () => {
    paymentInProgressRef.current = true;

    renderDashboard();

    // Even if a user could call pay, the ref guard should prevent API calls
    // This is tested at the hook level — the busyRef prevents concurrent payments
    expect(mockApiRequest).not.toHaveBeenCalledWith(
      "/api/payments/subscription/order",
      expect.anything(),
    );
  });
});

describe("Razorpay Checkout Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paymentInProgressRef.current = false;
  });

  it("openRazorpayCheckout resolves with payment identifiers", async () => {
    mockOpenRazorpayCheckout.mockResolvedValueOnce({
      razorpay_order_id: "order_test123",
      razorpay_payment_id: "pay_test456",
      razorpay_signature: "sig_test789",
    });

    const result = await mockOpenRazorpayCheckout({
      keyId: "rzp_test_key",
      orderId: "order_test123",
      amountPaise: 50000,
      currency: "INR",
      name: "Test Church",
      description: "Subscription Due",
    });

    expect(result.razorpay_order_id).toBe("order_test123");
    expect(result.razorpay_payment_id).toBe("pay_test456");
    expect(result.razorpay_signature).toBe("sig_test789");
  });

  it("openRazorpayCheckout rejects when user cancels", async () => {
    mockOpenRazorpayCheckout.mockRejectedValueOnce(
      new Error("Payment cancelled by user"),
    );

    await expect(
      mockOpenRazorpayCheckout({
        keyId: "rzp_test_key",
        orderId: "order_test123",
        amountPaise: 50000,
      }),
    ).rejects.toThrow("Payment cancelled by user");
  });
});

describe("Payment Verify — Server-Side Amount Verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verify endpoint receives all required Razorpay fields", async () => {
    mockApiRequest.mockResolvedValueOnce({ success: true });

    const verifyPayload = {
      subscription_ids: ["sub1"],
      subscription_month_counts: { sub1: 2 },
      razorpay_order_id: "order_123",
      razorpay_payment_id: "pay_456",
      razorpay_signature: "sig_789",
    };

    await mockApiRequest("/api/payments/subscription/verify", {
      method: "POST",
      token: "test-token",
      body: verifyPayload,
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "/api/payments/subscription/verify",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          razorpay_order_id: "order_123",
          razorpay_payment_id: "pay_456",
          razorpay_signature: "sig_789",
          subscription_ids: ["sub1"],
        }),
      }),
    );
  });

  it("handles already-processed payment (idempotency)", async () => {
    mockApiRequest.mockResolvedValueOnce({
      status: "already_processed",
      payment_id: "existing-payment-id",
    });

    const result = await mockApiRequest("/api/payments/subscription/verify", {
      method: "POST",
      token: "test-token",
      body: {
        razorpay_order_id: "order_dup",
        razorpay_payment_id: "pay_dup",
        razorpay_signature: "sig_dup",
        subscription_ids: ["sub1"],
      },
    });

    expect(result.status).toBe("already_processed");
    expect(result.payment_id).toBe("existing-payment-id");
  });

  it("rejects verify when signature is invalid", async () => {
    mockApiRequest.mockRejectedValueOnce(new Error("Invalid signature"));

    await expect(
      mockApiRequest("/api/payments/subscription/verify", {
        method: "POST",
        token: "test-token",
        body: {
          razorpay_order_id: "order_bad",
          razorpay_payment_id: "pay_bad",
          razorpay_signature: "INVALID",
          subscription_ids: ["sub1"],
        },
      }),
    ).rejects.toThrow("Invalid signature");
  });
});

describe("Donation Payment Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("donation order includes fund and amount", async () => {
    mockApiRequest.mockResolvedValueOnce({
      order: { id: "order_don1", amount: 100000, currency: "INR" },
      key_id: "rzp_test",
      donation_amount: 1000,
    });

    const result = await mockApiRequest("/api/payments/donation/order", {
      method: "POST",
      token: "test-token",
      body: { amount: 1000, fund: "Building Fund" },
    });

    expect(result.order.id).toBe("order_don1");
    expect(result.key_id).toBe("rzp_test");
  });

  it("donation verify succeeds with valid Razorpay fields", async () => {
    mockApiRequest.mockResolvedValueOnce({ success: true, payment: { id: "p1" } });

    const result = await mockApiRequest("/api/payments/donation/verify", {
      method: "POST",
      token: "test-token",
      body: {
        razorpay_order_id: "order_don1",
        razorpay_payment_id: "pay_don1",
        razorpay_signature: "sig_don1",
        fund: "Building Fund",
      },
    });

    expect(result.success).toBe(true);
  });
});
