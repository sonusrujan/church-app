import { describe, it, expect } from "vitest";
import { createReceiptNumber, buildPaymentReceiptDownloadPath } from "../services/receiptService";

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
    // With 4 hex digits of randomness, 50 should all be unique
    expect(receipts.size).toBe(50);
  });
});

describe("buildPaymentReceiptDownloadPath", () => {
  it("returns correct path", () => {
    const path = buildPaymentReceiptDownloadPath("abc-123");
    expect(path).toBe("/api/payments/abc-123/receipt");
  });
});
