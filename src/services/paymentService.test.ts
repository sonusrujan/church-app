import { describe, it, expect } from "vitest";
import { verifyPayment } from "../services/paymentService";
import crypto from "crypto";

describe("verifyPayment", () => {
  const credentials = {
    key_id: "rzp_test_key",
    key_secret: "test_secret_12345",
  };

  it("returns true for a valid HMAC signature", async () => {
    const orderId = "order_ABC123";
    const paymentId = "pay_XYZ789";
    const validSignature = crypto
      .createHmac("sha256", credentials.key_secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const result = await verifyPayment(validSignature, orderId, paymentId, credentials);
    expect(result).toBe(true);
  });

  it("returns false for an invalid signature", async () => {
    const result = await verifyPayment(
      "invalid_signature_here",
      "order_ABC123",
      "pay_XYZ789",
      credentials
    );
    expect(result).toBe(false);
  });

  it("returns false for tampered order ID", async () => {
    const orderId = "order_ABC123";
    const paymentId = "pay_XYZ789";
    const validSignature = crypto
      .createHmac("sha256", credentials.key_secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    // Use a different order ID
    const result = await verifyPayment(validSignature, "order_TAMPERED", paymentId, credentials);
    expect(result).toBe(false);
  });

  it("throws when key_secret is missing", async () => {
    await expect(
      verifyPayment("sig", "order_1", "pay_1", { key_id: "key", key_secret: "" })
    ).rejects.toThrow("Razorpay key_secret is missing");
  });
});
