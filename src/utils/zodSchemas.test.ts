import { describe, it, expect } from "vitest";
import {
  otpSendSchema,
  otpVerifySchema,
  syncProfileSchema,
  updateProfileSchema,
  joinChurchSchema,
  addFamilyMemberSchema,
  updateFamilyMemberSchema,
  createFamilyRequestSchema,
} from "./zodSchemas";

describe("Zod Validation Schemas", () => {
  // ── OTP schemas ──

  describe("otpSendSchema", () => {
    it("accepts valid phone", () => {
      const result = otpSendSchema.safeParse({ phone: "+919876543210" });
      expect(result.success).toBe(true);
    });

    it("rejects empty body", () => {
      const result = otpSendSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-string phone", () => {
      const result = otpSendSchema.safeParse({ phone: 12345 });
      expect(result.success).toBe(false);
    });

    it("strips whitespace from phone", () => {
      const result = otpSendSchema.safeParse({ phone: "+91 987 654 3210" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.phone).toBe("+919876543210");
      }
    });
  });

  describe("otpVerifySchema", () => {
    it("accepts valid phone + otp", () => {
      const result = otpVerifySchema.safeParse({ phone: "+919876543210", otp: "123456" });
      expect(result.success).toBe(true);
    });

    it("rejects missing otp", () => {
      const result = otpVerifySchema.safeParse({ phone: "+919876543210" });
      expect(result.success).toBe(false);
    });

    it("rejects empty otp string", () => {
      const result = otpVerifySchema.safeParse({ phone: "+919876543210", otp: "" });
      expect(result.success).toBe(false);
    });
  });

  // ── Auth route schemas ──

  describe("syncProfileSchema", () => {
    it("accepts empty body (all fields optional)", () => {
      const result = syncProfileSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts full_name and church_id", () => {
      const result = syncProfileSchema.safeParse({ full_name: "John", church_id: "abc" });
      expect(result.success).toBe(true);
    });
  });

  describe("updateProfileSchema", () => {
    it("accepts empty body (all fields optional)", () => {
      const result = updateProfileSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts valid preferred_language", () => {
      const result = updateProfileSchema.safeParse({ preferred_language: "te" });
      expect(result.success).toBe(true);
    });

    it("rejects invalid preferred_language", () => {
      const result = updateProfileSchema.safeParse({ preferred_language: "fr" });
      expect(result.success).toBe(false);
    });

    it("accepts boolean dark_mode", () => {
      const result = updateProfileSchema.safeParse({ dark_mode: true });
      expect(result.success).toBe(true);
    });

    it("rejects non-boolean dark_mode", () => {
      const result = updateProfileSchema.safeParse({ dark_mode: "yes" });
      expect(result.success).toBe(false);
    });
  });

  describe("joinChurchSchema", () => {
    it("accepts valid church_code and full_name", () => {
      const result = joinChurchSchema.safeParse({ church_code: "ABC123", full_name: "John Doe" });
      expect(result.success).toBe(true);
    });

    it("rejects missing church_code", () => {
      const result = joinChurchSchema.safeParse({ full_name: "John" });
      expect(result.success).toBe(false);
    });

    it("rejects empty church_code", () => {
      const result = joinChurchSchema.safeParse({ church_code: "", full_name: "John" });
      expect(result.success).toBe(false);
    });

    it("rejects missing full_name", () => {
      const result = joinChurchSchema.safeParse({ church_code: "ABC" });
      expect(result.success).toBe(false);
    });
  });

  // ── Family member schemas ──

  describe("addFamilyMemberSchema", () => {
    it("accepts minimal input (just full_name)", () => {
      const result = addFamilyMemberSchema.safeParse({ full_name: "Jane" });
      expect(result.success).toBe(true);
    });

    it("rejects empty full_name", () => {
      const result = addFamilyMemberSchema.safeParse({ full_name: "" });
      expect(result.success).toBe(false);
    });

    it("accepts full input with all fields", () => {
      const result = addFamilyMemberSchema.safeParse({
        full_name: "Jane",
        gender: "female",
        relation: "daughter",
        age: 25,
        dob: "1999-01-15",
        add_subscription: true,
        subscription_amount: 500,
        billing_cycle: "monthly",
      });
      expect(result.success).toBe(true);
    });

    it("rejects age over 150", () => {
      const result = addFamilyMemberSchema.safeParse({ full_name: "Jane", age: 200 });
      expect(result.success).toBe(false);
    });

    it("rejects negative age", () => {
      const result = addFamilyMemberSchema.safeParse({ full_name: "Jane", age: -1 });
      expect(result.success).toBe(false);
    });

    it("coerces string age to number", () => {
      const result = addFamilyMemberSchema.safeParse({ full_name: "Jane", age: "30" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.age).toBe(30);
      }
    });

    it("rejects subscription_amount below 200", () => {
      const result = addFamilyMemberSchema.safeParse({
        full_name: "Jane",
        add_subscription: true,
        subscription_amount: 50,
      });
      expect(result.success).toBe(false);
    });

    it("defaults billing_cycle to monthly", () => {
      const result = addFamilyMemberSchema.safeParse({ full_name: "Jane" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.billing_cycle).toBe("monthly");
      }
    });

    it("accepts yearly billing_cycle", () => {
      const result = addFamilyMemberSchema.safeParse({ full_name: "Jane", billing_cycle: "yearly" });
      expect(result.success).toBe(true);
    });
  });

  describe("updateFamilyMemberSchema", () => {
    it("accepts empty body (all optional)", () => {
      const result = updateFamilyMemberSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts valid age", () => {
      const result = updateFamilyMemberSchema.safeParse({ age: 45 });
      expect(result.success).toBe(true);
    });

    it("rejects invalid dob format", () => {
      const result = updateFamilyMemberSchema.safeParse({ dob: "15-01-1999" });
      expect(result.success).toBe(false);
    });
  });

  describe("createFamilyRequestSchema", () => {
    it("accepts valid target_member_id and relation", () => {
      const result = createFamilyRequestSchema.safeParse({
        target_member_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        relation: "spouse",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid UUID", () => {
      const result = createFamilyRequestSchema.safeParse({
        target_member_id: "not-a-uuid",
        relation: "spouse",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty relation", () => {
      const result = createFamilyRequestSchema.safeParse({
        target_member_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        relation: "",
      });
      expect(result.success).toBe(false);
    });
  });
});
