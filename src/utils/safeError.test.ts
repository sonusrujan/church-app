import { describe, it, expect } from "vitest";
import { safeErrorMessage } from "./safeError";

describe("safeErrorMessage", () => {
  const FALLBACK = "Something went wrong";

  // ── Null/undefined/empty input ──

  it("returns fallback for null", () => {
    expect(safeErrorMessage(null, FALLBACK)).toBe(FALLBACK);
  });

  it("returns fallback for undefined", () => {
    expect(safeErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it("returns fallback for empty error object", () => {
    expect(safeErrorMessage({}, FALLBACK)).toBe(FALLBACK);
  });

  it("returns fallback for empty string error", () => {
    expect(safeErrorMessage("", FALLBACK)).toBe(FALLBACK);
  });

  // ── Business-logic errors pass through ──

  it("passes through business-logic error message", () => {
    expect(safeErrorMessage(new Error("Member not found"), FALLBACK)).toBe("Member not found");
  });

  it("passes through a plain string error", () => {
    expect(safeErrorMessage("Subscription expired", FALLBACK)).toBe("Subscription expired");
  });

  // ── Internal SQL errors are hidden ──

  it("hides 'column X does not exist'", () => {
    expect(safeErrorMessage(new Error('column "foo" does not exist'), FALLBACK)).toBe(FALLBACK);
  });

  it("hides 'relation X does not exist'", () => {
    expect(safeErrorMessage(new Error('relation "users" does not exist'), FALLBACK)).toBe(FALLBACK);
  });

  it("hides 'duplicate key value'", () => {
    expect(safeErrorMessage(new Error("duplicate key value violates unique constraint"), FALLBACK)).toBe(FALLBACK);
  });

  it("hides 'violates X constraint'", () => {
    expect(safeErrorMessage(new Error("violates foreign key constraint"), FALLBACK)).toBe(FALLBACK);
  });

  it("hides 'syntax error'", () => {
    expect(safeErrorMessage(new Error("syntax error at position 42"), FALLBACK)).toBe(FALLBACK);
  });

  it("hides 'permission denied'", () => {
    expect(safeErrorMessage(new Error("permission denied for table users"), FALLBACK)).toBe(FALLBACK);
  });

  // ── Network errors are hidden ──

  it("hides ECONNREFUSED", () => {
    expect(safeErrorMessage(new Error("connect ECONNREFUSED 127.0.0.1:5432"), FALLBACK)).toBe(FALLBACK);
  });

  it("hides ETIMEDOUT", () => {
    expect(safeErrorMessage(new Error("connect ETIMEDOUT"), FALLBACK)).toBe(FALLBACK);
  });

  it("hides ENOTFOUND", () => {
    expect(safeErrorMessage(new Error("getaddrinfo ENOTFOUND example.com"), FALLBACK)).toBe(FALLBACK);
  });

  it("hides 'timeout exceeded'", () => {
    expect(safeErrorMessage(new Error("Query read timeout exceeded"), FALLBACK)).toBe(FALLBACK);
  });

  it("hides 'socket hang up'", () => {
    expect(safeErrorMessage(new Error("socket hang up"), FALLBACK)).toBe(FALLBACK);
  });

  it("hides 'network error'", () => {
    expect(safeErrorMessage(new Error("network error"), FALLBACK)).toBe(FALLBACK);
  });

  // ── JavaScript runtime errors are hidden ──

  it("hides 'unexpected token'", () => {
    expect(safeErrorMessage(new Error("unexpected token < in JSON at position 0"), FALLBACK)).toBe(FALLBACK);
  });

  it("hides 'cannot read propert'", () => {
    expect(safeErrorMessage(new Error("Cannot read properties of null (reading 'id')"), FALLBACK)).toBe(FALLBACK);
  });

  it("hides 'is not a function'", () => {
    expect(safeErrorMessage(new Error("foo.bar is not a function"), FALLBACK)).toBe(FALLBACK);
  });

  it("hides 'undefined is not'", () => {
    expect(safeErrorMessage(new Error("undefined is not an object"), FALLBACK)).toBe(FALLBACK);
  });

  // ── Edge cases ──

  it("handles Error-like object with message key", () => {
    expect(safeErrorMessage({ message: "Permission denied for role" }, FALLBACK)).toBe(FALLBACK);
  });

  it("returns different fallback strings correctly", () => {
    expect(safeErrorMessage(null, "Custom fallback")).toBe("Custom fallback");
  });
});
