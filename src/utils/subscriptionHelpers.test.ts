import { describe, it, expect, vi, afterEach } from "vitest";
import {
  computeNextDueDate,
  isDueSubscription,
  normalizeSelectedSubscriptionIds,
} from "../utils/subscriptionHelpers";

// ─── computeNextDueDate ──────────────────────────────────────────────

describe("computeNextDueDate", () => {
  afterEach(() => { vi.useRealTimers(); });

  // Pin "today" so the advance-past-today logic is deterministic
  function pinDate(iso: string) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  }

  it("returns 5th of next month for monthly billing", () => {
    pinDate("2025-06-10T00:00:00Z");
    expect(computeNextDueDate("2025-06-05", "monthly")).toBe("2025-07-05");
  });

  it("handles end-of-year rollover for monthly", () => {
    pinDate("2025-12-10T00:00:00Z");
    expect(computeNextDueDate("2025-12-05", "monthly")).toBe("2026-01-05");
  });

  it("returns 5th of same month next year for yearly billing", () => {
    pinDate("2025-04-01T00:00:00Z");
    expect(computeNextDueDate("2025-03-05", "yearly")).toBe("2026-03-05");
  });

  it("defaults to monthly when billing cycle is empty", () => {
    pinDate("2025-06-10T00:00:00Z");
    expect(computeNextDueDate("2025-06-05", "")).toBe("2025-07-05");
  });

  it("is case-insensitive for billing cycle", () => {
    pinDate("2025-02-01T00:00:00Z");
    expect(computeNextDueDate("2025-01-05", "YEARLY")).toBe("2026-01-05");
    expect(computeNextDueDate("2025-01-05", "Monthly")).toBe("2025-02-05");
  });

  it("falls back to next month 5th for invalid date", () => {
    pinDate("2025-06-10T00:00:00Z");
    const result = computeNextDueDate("not-a-date", "monthly");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.endsWith("-05")).toBe(true);
  });

  it("handles dates not on the 5th", () => {
    pinDate("2025-06-10T00:00:00Z");
    expect(computeNextDueDate("2025-06-15", "monthly")).toBe("2025-07-05");
  });

  it("skips over past dates to find next future due date", () => {
    pinDate("2025-09-10T00:00:00Z");
    // Base is Jan — monthly should skip all the way to Oct 5
    expect(computeNextDueDate("2025-01-05", "monthly")).toBe("2025-10-05");
  });
});

// ─── isDueSubscription ───────────────────────────────────────────────

describe("isDueSubscription", () => {
  const now = new Date("2025-07-10T12:00:00Z");

  it("returns true for overdue status regardless of date", () => {
    expect(
      isDueSubscription({ status: "overdue", next_payment_date: "2099-12-05" }, now)
    ).toBe(true);
  });

  it("returns false for cancelled subscriptions", () => {
    expect(
      isDueSubscription({ status: "cancelled", next_payment_date: "2020-01-01" }, now)
    ).toBe(false);
  });

  it("returns false for paused subscriptions", () => {
    expect(
      isDueSubscription({ status: "paused", next_payment_date: "2020-01-01" }, now)
    ).toBe(false);
  });

  it("returns true when next_payment_date is in the past", () => {
    expect(
      isDueSubscription({ status: "active", next_payment_date: "2025-07-05" }, now)
    ).toBe(true);
  });

  it("returns true when next_payment_date equals now", () => {
    expect(
      isDueSubscription({ status: "active", next_payment_date: "2025-07-10" }, now)
    ).toBe(true);
  });

  it("returns false when next_payment_date is in the future", () => {
    expect(
      isDueSubscription({ status: "active", next_payment_date: "2025-08-05" }, now)
    ).toBe(false);
  });

  it("returns false for invalid date", () => {
    expect(
      isDueSubscription({ status: "active", next_payment_date: "invalid" }, now)
    ).toBe(false);
  });

  it("is case-insensitive for status", () => {
    expect(
      isDueSubscription({ status: "OVERDUE", next_payment_date: "2099-12-05" }, now)
    ).toBe(true);
    expect(
      isDueSubscription({ status: "Cancelled", next_payment_date: "2020-01-01" }, now)
    ).toBe(false);
  });
});

// ─── normalizeSelectedSubscriptionIds ────────────────────────────────

describe("normalizeSelectedSubscriptionIds", () => {
  it("returns empty array for non-array input", () => {
    expect(normalizeSelectedSubscriptionIds(null)).toEqual([]);
    expect(normalizeSelectedSubscriptionIds(undefined)).toEqual([]);
    expect(normalizeSelectedSubscriptionIds("string")).toEqual([]);
    expect(normalizeSelectedSubscriptionIds(42)).toEqual([]);
    expect(normalizeSelectedSubscriptionIds({})).toEqual([]);
  });

  it("returns trimmed string entries", () => {
    expect(
      normalizeSelectedSubscriptionIds(["  abc  ", "def", " ghi "])
    ).toEqual(["abc", "def", "ghi"]);
  });

  it("filters out empty strings and non-strings", () => {
    expect(
      normalizeSelectedSubscriptionIds(["abc", "", "  ", 123, null, "def"])
    ).toEqual(["abc", "def"]);
  });

  it("returns empty array for empty array", () => {
    expect(normalizeSelectedSubscriptionIds([])).toEqual([]);
  });
});
