import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  openRazorpayCheckout: vi.fn(),
  refreshMemberDashboard: vi.fn(),
}));

const mockApiRequest = mocks.apiRequest;
const mockOpenRazorpayCheckout = mocks.openRazorpayCheckout;
const mockRefreshMemberDashboard = mocks.refreshMemberDashboard;

vi.mock("../lib/api", () => ({
  apiRequest: (...args: unknown[]) => mocks.apiRequest(...args),
  setActiveChurchId: vi.fn(),
  getActiveChurchId: () => "church-1",
  setTokenRefreshCallback: vi.fn(),
  tryRefreshToken: vi.fn().mockResolvedValue(null),
  API_BASE_URL: "http://localhost:4000",
}));

vi.mock("../lib/razorpayCheckout", () => ({
  openRazorpayCheckout: (...args: unknown[]) => mocks.openRazorpayCheckout(...args),
}));

vi.mock("../i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "checkout.processingFee") return `Processing fee (${params?.percent}%)`;
      if (key === "donation.thankYouDesc") return `Thank you for ${params?.amount} to ${params?.fund}`;
      return key;
    },
    language: "en",
    setLanguage: vi.fn(),
  }),
}));

vi.mock("../context/AppContext", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  const context = ReactModule.createContext<any>({
    token: "member-token",
    refreshMemberDashboard: mocks.refreshMemberDashboard,
  });
  return {
    default: context,
    useApp: () => ReactModule.useContext(context),
  };
});

import AppContext from "../context/AppContext";
import PublicDonationPage from "../pages/PublicDonationPage";
import DonationCheckoutPage from "../pages/DonationCheckoutPage";

function DonationStateProbe() {
  const location = useLocation();
  return <pre data-testid="donation-state">{JSON.stringify(location.state)}</pre>;
}

function mockPublicDonationApis({ paymentsEnabled = true, feePercent = 5 } = {}) {
  mockApiRequest.mockImplementation((url: string) => {
    if (url.startsWith("/api/churches/public-info")) return Promise.resolve({ name: "Grace Church" });
    if (url.startsWith("/api/donation-funds/public")) return Promise.resolve([{ name: "Building Fund", description: "Repairs" }]);
    if (url.startsWith("/api/payments/public/config")) {
      return Promise.resolve({
        payments_enabled: paymentsEnabled,
        public_donation_fee_percent: feePercent,
      });
    }
    return Promise.resolve([]);
  });
}

describe("PublicDonationPage regression coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPublicDonationApis();
  });

  it("passes server fee settings to checkout route state and shows the post-fee total", async () => {
    render(
      <MemoryRouter initialEntries={["/donate?church=church-1"]}>
        <Routes>
          <Route path="/donate" element={<PublicDonationPage />} />
          <Route path="/donate/checkout" element={<DonationStateProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("Grace Church");
    await screen.findByRole("option", { name: "Building Fund" });

    await userEvent.click(screen.getByRole("button", { name: "₹500" }));
    await userEvent.type(screen.getByPlaceholderText("donation.fullName *"), "Test Donor");
    await userEvent.type(screen.getByPlaceholderText("donation.emailAddress *"), "donor@example.com");
    await userEvent.type(screen.getByPlaceholderText("donation.phoneNumber *"), "9876543210");

    const continueButton = screen.getByRole("button", { name: /donation\.continueToPayment/ });
    expect(continueButton).toHaveTextContent("₹525");
    await userEvent.click(continueButton);

    const state = JSON.parse(await screen.findByTestId("donation-state").then((node) => node.textContent || "{}"));
    expect(state).toMatchObject({
      amount: 500,
      churchId: "church-1",
      churchName: "Grace Church",
      donorEmail: "donor@example.com",
      fund: "Building Fund",
      platformFeeEnabled: true,
      platformFeePercent: 5,
    });
  });

  it("blocks checkout when public payment config disables payments", async () => {
    mockPublicDonationApis({ paymentsEnabled: false, feePercent: 0 });

    render(
      <MemoryRouter initialEntries={["/donate?church=church-1"]}>
        <PublicDonationPage />
      </MemoryRouter>,
    );

    await screen.findByText("Grace Church");
    await userEvent.click(screen.getByRole("button", { name: "₹500" }));
    await userEvent.type(screen.getByPlaceholderText("donation.fullName *"), "Test Donor");
    await userEvent.type(screen.getByPlaceholderText("donation.emailAddress *"), "donor@example.com");
    await userEvent.type(screen.getByPlaceholderText("donation.phoneNumber *"), "9876543210");

    expect(screen.getByRole("button", { name: /donation\.continueToPayment/ })).toBeDisabled();
    expect(screen.getByText("dashboard.errorPaymentsDisabled")).toBeVisible();
  });
});

describe("DonationCheckoutPage regression coverage", () => {
  const checkoutState = {
    amount: 500,
    fund: "Building Fund",
    churchId: "church-1",
    churchName: "Grace Church",
    donorName: "Test Donor",
    donorEmail: "donor@example.com",
    donorPhone: "9876543210",
    message: "For repairs",
    platformFeeEnabled: true,
    platformFeePercent: 5,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRequest.mockReset();
    mockOpenRazorpayCheckout.mockReset();
    mockRefreshMemberDashboard.mockResolvedValue(undefined);
  });

  function renderCheckout(isLoggedIn = false) {
    render(
      <AppContext.Provider value={{ token: "member-token", refreshMemberDashboard: mockRefreshMemberDashboard } as any}>
        <MemoryRouter initialEntries={[{ pathname: "/donate/checkout", state: checkoutState }]}>
          <Routes>
            <Route path="/donate/checkout" element={<DonationCheckoutPage isLoggedIn={isLoggedIn} />} />
            <Route path="/donate" element={<div>donate-redirect</div>} />
            <Route path="/dashboard" element={<div>dashboard</div>} />
          </Routes>
        </MemoryRouter>
      </AppContext.Provider>,
    );
  }

  it("creates the donation order from base amount and verifies with Razorpay identifiers", async () => {
    mockApiRequest
      .mockResolvedValueOnce({ key_id: "rzp_test", order: { id: "order_1", amount: 52500, currency: "INR" } })
      .mockResolvedValueOnce({ success: true, payment: { id: "payment-1" } });
    mockOpenRazorpayCheckout.mockResolvedValueOnce({
      razorpay_order_id: "order_1",
      razorpay_payment_id: "pay_1",
      razorpay_signature: "sig_1",
    });

    renderCheckout(true);
    await userEvent.click(screen.getByRole("button", { name: "checkout.payDonation" }));

    await waitFor(() => expect(screen.getByText("pay_1")).toBeVisible());
    expect(mockApiRequest).toHaveBeenNthCalledWith(
      1,
      "/api/payments/public/donation/order",
      expect.objectContaining({
        token: "member-token",
        body: expect.objectContaining({
          amount: 500,
          church_id: "church-1",
          fund: "Building Fund",
        }),
      }),
    );
    expect(mockApiRequest).toHaveBeenNthCalledWith(
      2,
      "/api/payments/public/donation/verify",
      expect.objectContaining({
        token: "member-token",
        body: expect.objectContaining({
          razorpay_order_id: "order_1",
          razorpay_payment_id: "pay_1",
          razorpay_signature: "sig_1",
          church_id: "church-1",
          fund: "Building Fund",
        }),
      }),
    );
    expect(mockRefreshMemberDashboard).toHaveBeenCalledOnce();
  });

  it("hides errors when Razorpay returns a typed cancellation", async () => {
    mockApiRequest.mockResolvedValueOnce({ key_id: "rzp_test", order: { id: "order_1", amount: 52500, currency: "INR" } });
    mockOpenRazorpayCheckout.mockRejectedValueOnce({ cancelled: true });

    renderCheckout();
    await userEvent.click(screen.getByRole("button", { name: "checkout.payDonation" }));

    await waitFor(() => expect(mockOpenRazorpayCheckout).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("donation.errorPaymentFailed")).not.toBeInTheDocument();
  });
});
