import { describe, it, expect } from "vitest";
import { normalizeIndianPhone, isValidIndianPhone } from "./phone";

describe("normalizeIndianPhone", () => {
  it("normalizes bare 10-digit number", () => {
    expect(normalizeIndianPhone("9876543210")).toBe("+919876543210");
  });

  it("normalizes +91 prefixed number", () => {
    expect(normalizeIndianPhone("+919876543210")).toBe("+919876543210");
  });

  it("normalizes 91 prefixed (no +)", () => {
    expect(normalizeIndianPhone("919876543210")).toBe("+919876543210");
  });

  it("strips spaces and dashes", () => {
    expect(normalizeIndianPhone("+91 987-654-3210")).toBe("+919876543210");
    expect(normalizeIndianPhone("98 76 54 32 10")).toBe("+919876543210");
  });

  it("strips parentheses", () => {
    expect(normalizeIndianPhone("(987) 6543210")).toBe("+919876543210");
  });

  it("returns empty for empty input", () => {
    expect(normalizeIndianPhone("")).toBe("");
    expect(normalizeIndianPhone("  ")).toBe("");
  });

  it("returns +91 + whatever digits for non-standard input", () => {
    expect(normalizeIndianPhone("123")).toBe("+91123");
  });
});

describe("isValidIndianPhone", () => {
  it("accepts valid normalized numbers", () => {
    expect(isValidIndianPhone("+919876543210")).toBe(true);
    expect(isValidIndianPhone("+916000000000")).toBe(true);
    expect(isValidIndianPhone("+917999999999")).toBe(true);
    expect(isValidIndianPhone("+918123456789")).toBe(true);
  });

  it("rejects numbers not starting with 6-9", () => {
    expect(isValidIndianPhone("+910123456789")).toBe(false);
    expect(isValidIndianPhone("+915123456789")).toBe(false);
  });

  it("rejects short numbers", () => {
    expect(isValidIndianPhone("+9198765")).toBe(false);
    expect(isValidIndianPhone("+91")).toBe(false);
  });

  it("rejects too-long numbers", () => {
    expect(isValidIndianPhone("+9198765432100")).toBe(false);
  });

  it("rejects non-normalized input", () => {
    expect(isValidIndianPhone("9876543210")).toBe(false);
    expect(isValidIndianPhone("")).toBe(false);
  });
});
