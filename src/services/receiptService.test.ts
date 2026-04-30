import { describe, it, expect } from "vitest";
import { createReceiptNumber, buildPaymentReceiptDownloadPath, generateReceiptPdfBuffer } from "../services/receiptService";

describe("createReceiptNumber", () => {
  it("produces a receipt number in the expected format", () => {
    const receipt = createReceiptNumber({
      member_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      payment_date: "2025-07-10T12:00:00Z",
      transaction_id: "pay_XYZ123abc456",
    });

    // Format: RCPT-YYYYMMDD-MEMBER-TXNLAST6-RAND4
    expect(receipt).toMatch(/^RCPT-20250710-[A-Z0-9]{6}-[A-Z0-9]{6}-[A-F0-9]{4}$/);
  });

  it("handles null transaction_id", () => {
    const receipt = createReceiptNumber({
      member_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      payment_date: "2025-07-10T12:00:00Z",
      transaction_id: null,
    });

    expect(receipt).toMatch(/^RCPT-20250710-/);
  });

  it("handles missing transaction_id (undefined)", () => {
    const receipt = createReceiptNumber({
      member_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      payment_date: "2025-07-10T12:00:00Z",
    });

    expect(receipt).toMatch(/^RCPT-20250710-/);
  });

  it("handles invalid payment_date by falling back to today's date", () => {
    const receipt = createReceiptNumber({
      member_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      payment_date: "not-a-date",
    });

    // Should still produce a valid receipt number
    expect(receipt).toMatch(/^RCPT-\d{8}-[A-Z0-9]{6}-[A-Z0-9]{6}-[A-F0-9]{4}$/);
  });

  it("produces unique receipt numbers (random component)", () => {
    const input = {
      member_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      payment_date: "2025-07-10T12:00:00Z",
      transaction_id: "pay_same",
    };

    const receipts = new Set<string>();
    for (let i = 0; i < 50; i++) {
      receipts.add(createReceiptNumber(input));
    }
    // Random tokens may collide, so this verifies the component varies without
    // making the test depend on a zero-collision run.
    expect(receipts.size).toBeGreaterThan(1);
  });
});

describe("buildPaymentReceiptDownloadPath", () => {
  it("returns correct path", () => {
    const path = buildPaymentReceiptDownloadPath("abc-123");
    expect(path).toBe("/api/payments/abc-123/receipt");
  });
});

describe("generateReceiptPdfBuffer", () => {
  it("returns a valid PDF document", async () => {
    const buffer = await generateReceiptPdfBuffer({
      receipt_number: "RCPT-20260426-535293-B06560-EA06",
      payment_id: "de42b11c-77ac-45d6-9eca-adfee8560d74",
      payment_date: "2026-04-26T15:32:00+05:30",
      amount: 400,
      payment_method: "subscription_paynow",
      payment_status: "success",
      transaction_id: "pay_Si55usxuVJDFBL",
      member_name: "Narra Srujan",
      member_email: "+917672013499",
      church_name: "CSI Christ Church Pastorate II - Kurnool",
      subscription_id: "7c0b7402-7991-4dd0-897a-bbc2bbb06560",
      subscription_name: "Monthly Subscription",
      months_covered: "May 2026",
      church_registered_address: "Kurnool, Andhra Pradesh",
    });

    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
