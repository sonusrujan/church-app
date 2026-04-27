import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest, ApiError } from "../lib/api";

describe("apiRequest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("throws ApiError with HTTP status for non-refreshable client errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }));

    try {
      await apiRequest("/api/payments/subscription/verify", {
        method: "POST",
        token: "token",
        body: { razorpay_signature: "bad" },
      });
      throw new Error("Expected apiRequest to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        name: "ApiError",
        status: 400,
        message: "Invalid signature",
      });
    }
  });
});
