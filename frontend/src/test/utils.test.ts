import { describe, it, expect } from "vitest";
import {
  isValidEmail,
  isValidIndianPhone,
  stripIndianPrefix,
  normalizeIndianPhone,
  formatAmount,
  initials,
} from "../types";

describe("isValidIndianPhone", () => {
  it("accepts 10-digit number starting with 6-9", () => {
    expect(isValidIndianPhone("9876543210")).toBe(true);
    expect(isValidIndianPhone("6000000000")).toBe(true);
  });

  it("accepts +91 prefixed numbers", () => {
    expect(isValidIndianPhone("+919876543210")).toBe(true);
  });

  it("rejects numbers starting with 0-5", () => {
    expect(isValidIndianPhone("0123456789")).toBe(false);
    expect(isValidIndianPhone("5123456789")).toBe(false);
  });

  it("rejects short numbers", () => {
    expect(isValidIndianPhone("98765")).toBe(false);
    expect(isValidIndianPhone("")).toBe(false);
  });

  it("rejects numbers with letters", () => {
    expect(isValidIndianPhone("98765abc10")).toBe(false);
  });

  it("strips formatting characters", () => {
    expect(isValidIndianPhone("987-654-3210")).toBe(true);
    expect(isValidIndianPhone("(987) 654 3210")).toBe(true);
  });
});

describe("stripIndianPrefix", () => {
  it("strips +91 prefix", () => {
    expect(stripIndianPrefix("+919876543210")).toBe("9876543210");
  });

  it("strips 91 prefix for numbers longer than 10 digits", () => {
    expect(stripIndianPrefix("919876543210")).toBe("9876543210");
  });

  it("keeps bare 10-digit number unchanged", () => {
    expect(stripIndianPrefix("9876543210")).toBe("9876543210");
  });

  it("handles whitespace and dashes", () => {
    expect(stripIndianPrefix("+91 987-654-3210")).toBe("9876543210");
  });
});

describe("normalizeIndianPhone", () => {
  it("normalizes bare 10-digit number", () => {
    expect(normalizeIndianPhone("9876543210")).toBe("+919876543210");
  });

  it("normalizes already-prefixed number", () => {
    expect(normalizeIndianPhone("+919876543210")).toBe("+919876543210");
  });

  it("strips formatting and normalizes", () => {
    expect(normalizeIndianPhone("987 654 3210")).toBe("+919876543210");
  });

  it("returns empty for empty input", () => {
    expect(normalizeIndianPhone("")).toBe("");
  });
});

describe("isValidEmail", () => {
  it("accepts valid emails", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("a.b@c.in")).toBe(true);
  });

  it("rejects invalid emails", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("@missing.com")).toBe(false);
    expect(isValidEmail("user@")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("formatAmount", () => {
  it("formats a number", () => {
    expect(formatAmount(1000)).toBe("Rs 1000.00");
  });

  it("handles zero and null", () => {
    expect(formatAmount(0)).toBe("Rs 0.00");
    expect(formatAmount(null)).toBe("Rs 0.00");
    expect(formatAmount(undefined)).toBe("Rs 0.00");
  });

  it("handles string amounts", () => {
    expect(formatAmount("250.5")).toBe("Rs 250.50");
  });
});

describe("initials", () => {
  it("gets two-letter initials from full name", () => {
    expect(initials("John Doe", "phone")).toBe("JD");
  });

  it("gets first two chars from single name", () => {
    expect(initials("Alice", "phone")).toBe("AL");
  });

  it("falls back to email/phone when name empty", () => {
    expect(initials(null, "sonu@test.com")).toBe("SO");
    expect(initials("", "9876543210")).toBe("98");
  });

  it("returns U for empty everything", () => {
    expect(initials("", "")).toBe("U");
  });
});
